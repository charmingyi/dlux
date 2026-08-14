package com.admin.service.impl;

import com.admin.common.dto.GostDto;
import com.admin.common.dto.WgMemberDto;
import com.admin.common.dto.WgNetworkDto;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.entity.Node;
import com.admin.entity.NodeWg;
import com.admin.entity.WgNetwork;
import com.admin.mapper.LinkMapper;
import com.admin.mapper.NodeWgMapper;
import com.admin.mapper.WgNetworkMapper;
import com.admin.service.NodeService;
import com.admin.service.WgNetworkService;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * <p>
 * WireGuard组网服务实现类
 *
 * 两阶段下发:
 *  阶段1: 向每个在线成员下发仅含本机参数的配置, 节点生成密钥并上报公钥
 *  阶段2: 向每个在线成员下发完整对端(peer)配置
 * </p>
 */
@Slf4j
@Service
public class WgNetworkServiceImpl extends ServiceImpl<WgNetworkMapper, WgNetwork> implements WgNetworkService {

    private static final String GOST_SUCCESS_MSG = "OK";
    private static final int KEEPALIVE = 25;

    private static final String ERROR_NETWORK_NOT_FOUND = "组网不存在";
    private static final String ERROR_NODE_NOT_FOUND = "节点不存在: %d";
    private static final String ERROR_NODE_OFFLINE = "节点 %s 不在线";
    private static final String ERROR_SUBNET_INVALID = "组网网段格式错误, 仅支持IPv4, 如 10.10.0.0/24";
    private static final String ERROR_PORT_INVALID = "监听端口必须在1024-65535之间";
    private static final String ERROR_NETWORK_IN_USE = "组网正在被线路使用, 请先删除相关线路";
    private static final String ERROR_IP_FULL = "组网地址已用尽";
    private static final String ERROR_MEMBER_EXISTS = "节点已在该组网中";
    private static final String ERROR_MEMBER_NOT_FOUND = "节点不在该组网中";

    @Resource
    private NodeService nodeService;

    @Resource
    private NodeWgMapper nodeWgMapper;

    @Resource
    @Lazy
    private LinkMapper linkMapper;

    @Override
    public R createNetwork(WgNetworkDto dto) {
        R validateResult = validateBase(dto);
        if (validateResult.getCode() != 0) {
            return validateResult;
        }

        WgNetwork network = new WgNetwork();
        BeanUtils.copyProperties(dto, network);
        long now = System.currentTimeMillis();
        network.setCreatedTime(now);
        network.setUpdatedTime(now);
        network.setStatus(1);

        if (!this.save(network)) {
            return R.err("组网创建失败");
        }

        List<Integer> nodeIds = dto.getMembers() == null ? new ArrayList<>() : extractNodeIds(dto.getMembers());
        R memberResult = addMembers(network, nodeIds);
        if (memberResult.getCode() != 0) {
            this.removeById(network.getId());
            return memberResult;
        }

        R syncResult = syncNetwork(network.getId());
        if (syncResult.getCode() != 0) {
            return syncResult;
        }
        return R.ok();
    }

    @Override
    public R getAllNetworks() {
        List<WgNetwork> networks = this.list(new QueryWrapper<WgNetwork>().orderByDesc("created_time"));
        List<WgNetworkDto> result = new ArrayList<>();
        for (WgNetwork network : networks) {
            result.add(toDto(network));
        }
        return R.ok(result);
    }

    @Override
    public R updateNetwork(Long id, WgNetworkDto dto) {
        WgNetwork network = this.getById(id);
        if (network == null) {
            return R.err(ERROR_NETWORK_NOT_FOUND);
        }

        if (dto.getName() != null) network.setName(dto.getName());
        if (dto.getSubnet() != null) network.setSubnet(dto.getSubnet());
        if (dto.getMode() != null) network.setMode(dto.getMode());
        if (dto.getListenPort() != null) network.setListenPort(dto.getListenPort());
        if (dto.getMtu() != null) network.setMtu(dto.getMtu());

        R validateResult = validateBase(fromEntity(network));
        if (validateResult.getCode() != 0) {
            return validateResult;
        }

        network.setUpdatedTime(System.currentTimeMillis());
        this.updateById(network);

        // 成员变化: 全量重建成员(先删后加)
        if (dto.getMembers() != null) {
            List<Integer> newIds = extractNodeIds(dto.getMembers());
            Set<Integer> oldIds = new HashSet<>();
            for (NodeWg nw : nodeWgMapper.selectList(new QueryWrapper<NodeWg>().eq("wg_network_id", id))) {
                oldIds.add(nw.getNodeId());
            }
            for (Integer nodeId : newIds) {
                if (!oldIds.contains(nodeId)) {
                    R addResult = addMember(network, nodeId);
                    if (addResult.getCode() != 0) {
                        return addResult;
                    }
                }
            }
            for (Integer nodeId : oldIds) {
                if (!newIds.contains(nodeId)) {
                    R removeResult = removeMember(network, nodeId);
                    if (removeResult.getCode() != 0) {
                        return removeResult;
                    }
                }
            }
            // hub模式确保有中心节点
            ensureHub(network);
        }

        R syncResult = syncNetwork(id);
        if (syncResult.getCode() != 0) {
            return syncResult;
        }
        return R.ok();
    }

    @Override
    public R deleteNetwork(Long id) {
        WgNetwork network = this.getById(id);
        if (network == null) {
            return R.err(ERROR_NETWORK_NOT_FOUND);
        }

        Long linkCount = linkMapper.selectLinkCountByWgNetwork(id.intValue());
        if (linkCount != null && linkCount > 0) {
            return R.err(ERROR_NETWORK_IN_USE);
        }

        List<NodeWg> members = nodeWgMapper.selectList(new QueryWrapper<NodeWg>().eq("wg_network_id", id));
        for (NodeWg member : members) {
            try {
                GostUtil.WgRemove(member.getNodeId().longValue(), network.getId().toString());
            } catch (Exception e) {
                log.warn("移除节点组网失败 node={}: {}", member.getNodeId(), e.getMessage());
            }
        }
        nodeWgMapper.delete(new QueryWrapper<NodeWg>().eq("wg_network_id", id));
        this.removeById(id);
        return R.ok();
    }

    /**
     * 两阶段同步
     */
    @Override
    public R syncNetwork(Long id) {
        WgNetwork network = this.getById(id);
        if (network == null) {
            return R.err(ERROR_NETWORK_NOT_FOUND);
        }

        List<NodeWg> members = nodeWgMapper.selectList(new QueryWrapper<NodeWg>()
                .eq("wg_network_id", id).eq("status", 1));

        // 阶段1: 获取/更新各节点公钥
        for (NodeWg member : members) {
            Node node = nodeService.getById(member.getNodeId());
            if (node == null || node.getStatus() == null || node.getStatus() != 1) {
                continue;
            }
            JSONObject req = buildBaseRequest(network, member);
            GostDto result = GostUtil.WgApply(node.getId(), req);
            if (isGostOperationSuccess(result) && result.getData() != null) {
                try {
                    JSONObject resp = (JSONObject) JSONObject.toJSON(result.getData());
                    String publicKey = resp.getString("publicKey");
                    if (publicKey != null && !publicKey.equals(member.getPublicKey())) {
                        member.setPublicKey(publicKey);
                        member.setUpdatedTime(System.currentTimeMillis());
                        nodeWgMapper.updateById(member);
                    }
                } catch (Exception e) {
                    log.warn("解析节点公钥失败 node={}: {}", node.getId(), e.getMessage());
                }
            } else {
                log.warn("阶段1下发失败 node={}: {}", node.getId(), result.getMsg());
            }
        }

        // 阶段2: 下发完整对端配置
        boolean allOnline = true;
        for (NodeWg member : members) {
            Node node = nodeService.getById(member.getNodeId());
            if (node == null || node.getStatus() == null || node.getStatus() != 1) {
                allOnline = false;
                continue;
            }
            JSONObject req = buildFullRequest(network, member, members);
            GostDto result = GostUtil.WgApply(node.getId(), req);
            if (!isGostOperationSuccess(result)) {
                log.warn("阶段2下发失败 node={}: {}", node.getId(), result.getMsg());
            }
        }

        if (!allOnline) {
            return R.ok("部分节点离线, 已为在线节点下发配置");
        }
        return R.ok();
    }

    // ==================== 内部方法 ====================

    private R validateBase(WgNetworkDto dto) {
        if (dto.getSubnet() == null || !dto.getSubnet().matches("^\\d{1,3}(\\.\\d{1,3}){3}/\\d{1,2}$")) {
            return R.err(ERROR_SUBNET_INVALID);
        }
        String[] parts = dto.getSubnet().split("/");
        int prefix = Integer.parseInt(parts[1]);
        if (prefix < 8 || prefix > 30) {
            return R.err(ERROR_SUBNET_INVALID);
        }
        try {
            InetAddress.getByName(parts[0]);
        } catch (UnknownHostException e) {
            return R.err(ERROR_SUBNET_INVALID);
        }
        if (dto.getListenPort() != null && (dto.getListenPort() < 1024 || dto.getListenPort() > 65535)) {
            return R.err(ERROR_PORT_INVALID);
        }
        if (dto.getMode() != null && !"mesh".equals(dto.getMode()) && !"hub".equals(dto.getMode())) {
            return R.err("mode 仅支持 mesh 或 hub");
        }
        return R.ok();
    }

    private List<Integer> extractNodeIds(List<WgMemberDto> members) {
        List<Integer> ids = new ArrayList<>();
        for (WgMemberDto member : members) {
            if (member.getNodeId() != null) {
                ids.add(member.getNodeId());
            }
        }
        return ids;
    }

    private WgNetworkDto fromEntity(WgNetwork network) {
        WgNetworkDto dto = new WgNetworkDto();
        BeanUtils.copyProperties(network, dto);
        return dto;
    }

    private WgNetworkDto toDto(WgNetwork network) {
        WgNetworkDto dto = new WgNetworkDto();
        BeanUtils.copyProperties(network, dto);
        dto.setMembers(new ArrayList<>());

        List<NodeWg> members = nodeWgMapper.selectList(new QueryWrapper<NodeWg>()
                .eq("wg_network_id", network.getId()).eq("status", 1));
        for (NodeWg member : members) {
            WgMemberDto md = new WgMemberDto();
            md.setId(member.getId());
            md.setNodeId(member.getNodeId());
            md.setIp(member.getIp());
            md.setHub(member.getHub());
            md.setPublicKey(member.getPublicKey());
            md.setApplied(1);
            Node node = nodeService.getById(member.getNodeId());
            if (node != null) {
                md.setNodeName(node.getName());
                md.setNodeServerIp(node.getServerIp());
                md.setNodeStatus(node.getStatus());
            }
            dto.getMembers().add(md);
        }
        return dto;
    }

    private R addMembers(WgNetwork network, List<Integer> nodeIds) {
        for (Integer nodeId : nodeIds) {
            R result = addMember(network, nodeId);
            if (result.getCode() != 0) {
                return result;
            }
        }
        if ("hub".equals(network.getMode())) {
            ensureHub(network);
        }
        return R.ok();
    }

    private R addMember(WgNetwork network, Integer nodeId) {
        Node node = nodeService.getById(nodeId);
        if (node == null) {
            return R.err(String.format(ERROR_NODE_NOT_FOUND, nodeId));
        }
        if (node.getStatus() == null || node.getStatus() != 1) {
            return R.err(String.format(ERROR_NODE_OFFLINE, node.getName()));
        }

        Long exists = nodeWgMapper.selectCount(new QueryWrapper<NodeWg>()
                .eq("wg_network_id", network.getId()).eq("node_id", nodeId));
        if (exists != null && exists > 0) {
            return R.err(ERROR_MEMBER_EXISTS);
        }

        String ip = allocateIp(network);
        if (ip == null) {
            return R.err(ERROR_IP_FULL);
        }

        NodeWg member = new NodeWg();
        member.setWgNetworkId(network.getId().intValue());
        member.setNodeId(nodeId);
        member.setIp(ip);
        member.setHub(0);
        long now = System.currentTimeMillis();
        member.setCreatedTime(now);
        member.setUpdatedTime(now);
        member.setStatus(1);
        nodeWgMapper.insert(member);
        return R.ok();
    }

    private R removeMember(WgNetwork network, Integer nodeId) {
        NodeWg member = nodeWgMapper.selectOne(new QueryWrapper<NodeWg>()
                .eq("wg_network_id", network.getId()).eq("node_id", nodeId));
        if (member == null) {
            return R.err(ERROR_MEMBER_NOT_FOUND);
        }
        try {
            GostUtil.WgRemove(nodeId.longValue(), network.getId().toString());
        } catch (Exception e) {
            log.warn("移除节点组网失败 node={}: {}", nodeId, e.getMessage());
        }
        nodeWgMapper.deleteById(member.getId());
        return R.ok();
    }

    private void ensureHub(WgNetwork network) {
        Long hubCount = nodeWgMapper.selectCount(new QueryWrapper<NodeWg>()
                .eq("wg_network_id", network.getId()).eq("hub", 1).eq("status", 1));
        if (hubCount == null || hubCount == 0) {
            NodeWg first = nodeWgMapper.selectOne(new QueryWrapper<NodeWg>()
                    .eq("wg_network_id", network.getId()).eq("status", 1)
                    .orderByAsc("id").last("LIMIT 1"));
            if (first != null) {
                first.setHub(1);
                nodeWgMapper.updateById(first);
            }
        }
    }

    /** 分配组网IP: 从 x.x.x.2 开始 */
    private String allocateIp(WgNetwork network) {
        String[] parts = network.getSubnet().split("/");
        String[] octets = parts[0].split("\\.");
        int base = Integer.parseInt(octets[3]);
        int prefix = Integer.parseInt(parts[1]);

        Set<String> used = new HashSet<>();
        for (NodeWg member : nodeWgMapper.selectList(new QueryWrapper<NodeWg>().eq("wg_network_id", network.getId()))) {
            used.add(member.getIp());
        }

        int start = Math.max(base + 2, 2);
        int maxHosts = prefix >= 30 ? 4 : (1 << (32 - prefix)) - 2;
        for (int i = 0; i < Math.min(maxHosts, 250); i++) {
            String candidate = octets[0] + "." + octets[1] + "." + octets[2] + "." + (start + i);
            if (!used.contains(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    /** 阶段1请求: 本机参数 */
    private JSONObject buildBaseRequest(WgNetwork network, NodeWg member) {
        JSONObject req = new JSONObject();
        req.put("name", network.getId().toString());
        req.put("address", member.getIp() + "/" + network.getSubnet().split("/")[1]);
        req.put("listenPort", getListenPort(network, member));
        req.put("mtu", network.getMtu() == null ? 1420 : network.getMtu());
        req.put("peers", new JSONArray());
        return req;
    }

    /** 阶段2请求: 完整对端配置 */
    private JSONObject buildFullRequest(WgNetwork network, NodeWg member, List<NodeWg> members) {
        JSONObject req = new JSONObject();
        req.put("name", network.getId().toString());
        req.put("address", member.getIp() + "/" + network.getSubnet().split("/")[1]);
        req.put("listenPort", getListenPort(network, member));
        req.put("mtu", network.getMtu() == null ? 1420 : network.getMtu());

        JSONArray peers = new JSONArray();
        if ("mesh".equals(network.getMode())) {
            for (NodeWg other : members) {
                if (Objects.equals(other.getId(), member.getId())) continue;
                if (other.getPublicKey() == null) continue;
                Node node = nodeService.getById(other.getNodeId());
                if (node == null) continue;
                JSONObject peer = buildPeer(other.getPublicKey(),
                        node.getServerIp() + ":" + network.getListenPort(), network.getSubnet());
                peers.add(peer);
            }
        } else {
            // hub模式: 非中心只连中心; 中心连所有
            if (member.getHub() != null && member.getHub() == 1) {
                for (NodeWg other : members) {
                    if (Objects.equals(other.getId(), member.getId())) continue;
                    if (other.getPublicKey() == null) continue;
                    Node node = nodeService.getById(other.getNodeId());
                    if (node == null) continue;
                    JSONObject peer = buildPeer(other.getPublicKey(),
                            node.getServerIp() + ":" + network.getListenPort(), network.getSubnet());
                    peers.add(peer);
                }
            } else {
                NodeWg hub = null;
                for (NodeWg other : members) {
                    if (other.getHub() != null && other.getHub() == 1) {
                        hub = other;
                        break;
                    }
                }
                if (hub != null && hub.getPublicKey() != null) {
                    Node hubNode = nodeService.getById(hub.getNodeId());
                    if (hubNode != null) {
                        JSONObject peer = buildPeer(hub.getPublicKey(),
                                hubNode.getServerIp() + ":" + network.getListenPort(), network.getSubnet());
                        peers.add(peer);
                    }
                }
            }
        }
        req.put("peers", peers);
        return req;
    }

    private JSONObject buildPeer(String publicKey, String endpoint, String subnet) {
        JSONObject peer = new JSONObject();
        peer.put("publicKey", publicKey);
        peer.put("endpoint", endpoint);
        JSONArray allowedIps = new JSONArray();
        allowedIps.add(subnet);
        peer.put("allowedIps", allowedIps);
        peer.put("persistentKeepalive", KEEPALIVE);
        return peer;
    }

    private int getListenPort(WgNetwork network, NodeWg member) {
        int port = network.getListenPort() == null ? 51820 : network.getListenPort();
        if ("hub".equals(network.getMode())) {
            if (member.getHub() == null || member.getHub() != 1) {
                return 0; // 分支节点不监听
            }
        }
        return port;
    }

    private boolean isGostOperationSuccess(GostDto gostResult) {
        return gostResult != null && Objects.equals(gostResult.getMsg(), GOST_SUCCESS_MSG);
    }

}

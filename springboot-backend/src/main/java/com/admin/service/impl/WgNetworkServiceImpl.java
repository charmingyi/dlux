package com.admin.service.impl;

import com.admin.common.dto.GostDto;
import com.admin.common.dto.WgMemberDto;
import com.admin.common.dto.WgNetworkDto;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.LatencyCache;
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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * <p>
 * WireGuard组网服务实现类
 *
 * 两阶段下发:
 *  阶段1: 仅准备密钥并上报公钥，不修改正在运行的接口
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
        // 网段/端口留空时自动分配不重复的值, 避免与既有组网冲突
        if (dto.getSubnet() == null || dto.getSubnet().trim().isEmpty()) {
            String subnet = allocateSubnet();
            if (subnet == null) {
                return R.err("自动分配网段失败: 10.10.0.0/16 内的 /24 网段已用尽, 请手动指定");
            }
            dto.setSubnet(subnet);
        }
        if (dto.getListenPort() == null || dto.getListenPort() == 0) {
            Integer port = allocateListenPort();
            if (port == null) {
                return R.err("自动分配监听端口失败: 51820-65535 已用尽, 请手动指定");
            }
            dto.setListenPort(port);
        }
        // 传输封装: 新组网默认 WSS over TCP(防运营商UDP限速)
        if (dto.getTransport() == null || dto.getTransport().trim().isEmpty()) {
            dto.setTransport("wss");
        }
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

        List<WgMemberDto> requestedMembers = dto.getMembers() == null ? new ArrayList<>() : dto.getMembers();
        R memberResult = addMembers(network, requestedMembers);
        if (memberResult.getCode() != 0) {
            this.removeById(network.getId());
            return memberResult;
        }

        R syncResult = syncNetwork(network.getId());
        if (syncResult.getCode() != 0) {
            return syncResult;
        }

        Map<String, Object> created = new HashMap<>();
        created.put("id", network.getId());
        created.put("subnet", network.getSubnet());
        created.put("listenPort", network.getListenPort());
        return R.ok(created);
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
        if (dto.getTransport() != null) network.setTransport(dto.getTransport());

        // WSS 仅支持 Hub 拓扑(分支只连中心, 全部流量走TCP)
        if ("wss".equals(network.getTransport()) && !"hub".equals(network.getMode())) {
            return R.err("WSS 封装当前仅支持 Hub 拓扑");
        }

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
            // 已存在成员的出口线路更新
            for (WgMemberDto m : dto.getMembers()) {
                if (m.getNodeId() == null || !oldIds.contains(m.getNodeId()) || m.getEgress() == null) continue;
                NodeWg nw = nodeWgMapper.selectOne(new QueryWrapper<NodeWg>()
                        .eq("wg_network_id", id).eq("node_id", m.getNodeId()));
                if (nw != null && !m.getEgress().equals(nw.getEgress() == null ? "" : nw.getEgress())) {
                    nw.setEgress(m.getEgress());
                    nw.setUpdatedTime(System.currentTimeMillis());
                    nodeWgMapper.updateById(nw);
                }
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
            applyRequestedHub(network, dto.getMembers());
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

        List<Integer> prepared = new ArrayList<>();
        List<Integer> applied = new ArrayList<>();
        List<Integer> offline = new ArrayList<>();
        List<String> errors = new ArrayList<>();

        // 阶段1: 只准备密钥。旧版节点不支持 WgPrepare 时回退到兼容路径。
        for (NodeWg member : members) {
            Node node = nodeService.getById(member.getNodeId());
            if (node == null || node.getStatus() == null || node.getStatus() != 1) {
				offline.add(member.getNodeId());
                continue;
            }
            GostDto result = GostUtil.WgPrepare(node.getId(), network.getId().toString());
            if (!isGostOperationSuccess(result) && isUnknownCommand(result)) {
                // 兼容 1.0.x：已有公钥时不再重复下发空 Peer 配置，避免同步期间断网。
                if (member.getPublicKey() != null && !member.getPublicKey().isBlank()) {
                    prepared.add(member.getNodeId());
                    continue;
                }
                // 首次加入的旧节点仍需通过 WgApply 生成密钥；升级 1.1.2 后将完全无中断。
                result = GostUtil.WgApply(node.getId(), buildBaseRequest(network, member));
            }
            if (isGostOperationSuccess(result) && result.getData() != null) {
                try {
                    JSONObject resp = (JSONObject) JSONObject.toJSON(result.getData());
                    String publicKey = resp.getString("publicKey");
                    if (publicKey != null && !publicKey.equals(member.getPublicKey())) {
                        member.setPublicKey(publicKey);
                        member.setUpdatedTime(System.currentTimeMillis());
                        nodeWgMapper.updateById(member);
                    }
					prepared.add(member.getNodeId());
                } catch (Exception e) {
                    log.warn("解析节点公钥失败 node={}: {}", node.getId(), e.getMessage());
					errors.add(node.getName() + ": 公钥响应无效");
                }
            } else {
				String message = result == null ? "节点无响应" : result.getMsg();
                log.warn("阶段1准备失败 node={}: {}", node.getId(), message);
				errors.add(node.getName() + ": " + message);
            }
        }

        // 阶段2: 下发完整对端配置
        for (NodeWg member : members) {
            Node node = nodeService.getById(member.getNodeId());
            if (node == null || node.getStatus() == null || node.getStatus() != 1) {
                continue;
            }
            JSONObject req = buildFullRequest(network, member, members);
            GostDto result = GostUtil.WgApply(node.getId(), req);
            if (!isGostOperationSuccess(result)) {
				String message = result == null ? "节点无响应" : result.getMsg();
                log.warn("阶段2下发失败 node={}: {}", node.getId(), message);
				errors.add(node.getName() + ": " + message);
			} else {
				applied.add(member.getNodeId());
			}
        }

		// 阶段2.5: 按传输封装下发。
		//  - wss: 确保各节点的 wstunnel 服务(中心=server, 分支=client)就绪,
		//    并且仍然下发出口钉定(钉的是封装TCP的外层路由, 防止被宿主遗留策略路由拉回病线)。
		//  - udp: 按成员配置下发出口线路策略。旧版Agent不支持时忽略。
		applyEgressPolicies(network, members);
		if ("wss".equals(network.getTransport())) {
			applyWss(network, members, applied);
		}

		// WireGuard 在首次下发 peer、切换端点或穿过 NAT 时需要短暂完成握手。
		// 立即 ICMP 会把“尚未握手”缓存成不可达，导致页面长期显示假阴性。
		if (!applied.isEmpty() && members.size() > 1) {
			try {
				Thread.sleep(3000);
			} catch (InterruptedException e) {
				Thread.currentThread().interrupt();
				return R.err("组网同步被中断，请重试");
			}
		}

        // 阶段3: 组网内ICMP延迟探测(节点互相ping组网IP)
        for (NodeWg member : members) {
            Node node = nodeService.getById(member.getNodeId());
            if (node == null || node.getStatus() == null || node.getStatus() != 1) {
                continue;
            }
            List<String> peerIps = new ArrayList<>();
            for (NodeWg other : members) {
                if (!Objects.equals(other.getId(), member.getId()) && other.getPublicKey() != null) {
                    peerIps.add(other.getIp());
                }
            }
            if (peerIps.isEmpty()) continue;
            GostDto result = GostUtil.PingIps(node.getId(), peerIps);
            if (isGostOperationSuccess(result) && result.getData() != null) {
                try {
                    JSONArray arr = (JSONArray) result.getData();
                    List<LatencyCache.ProbeEntry> entries = new ArrayList<>();
                    for (int i = 0; i < arr.size(); i++) {
                        JSONObject item = arr.getJSONObject(i);
                        LatencyCache.ProbeEntry entry = new LatencyCache.ProbeEntry();
                        entry.setKey("wg:" + network.getId() + ":" + member.getNodeId() + ":" + item.getString("ip"));
                        entry.setAddr(item.getString("ip"));
                        entry.setMs(item.getDoubleValue("ms"));
                        entry.setUp(item.getBooleanValue("up"));
                        entry.setTs(System.currentTimeMillis());
                        entries.add(entry);
                    }
                    LatencyCache.updateProbes(node.getId(), entries);
                } catch (Exception e) {
                    log.warn("解析组网延迟失败 node={}: {}", node.getId(), e.getMessage());
                }
            }
            syncTcpProbesWithoutWireGuard(node);
        }

        Map<String, Object> summary = new HashMap<>();
		summary.put("networkId", id);
		summary.put("prepared", prepared);
		summary.put("applied", applied);
		summary.put("offline", offline);
		summary.put("errors", errors);
		summary.put("timestamp", System.currentTimeMillis());

		R response = R.ok(summary);
		if (!errors.isEmpty()) {
			response.setMsg("同步完成，但有 " + errors.size() + " 个节点失败");
		} else if (!offline.isEmpty()) {
			response.setMsg("在线节点已同步，" + offline.size() + " 个离线节点待上线");
		} else {
			response.setMsg("组网配置已同步");
		}
		return response;
    }

    @Override
    public R getNetworkStatus(Long id) {
        WgNetwork network = this.getById(id);
        if (network == null) {
            return R.err(ERROR_NETWORK_NOT_FOUND);
        }

        List<NodeWg> members = nodeWgMapper.selectList(new QueryWrapper<NodeWg>()
                .eq("wg_network_id", id).eq("status", 1).orderByAsc("id"));
        List<Map<String, Object>> runtimeMembers = new ArrayList<>();
        for (NodeWg member : members) {
            Map<String, Object> item = new HashMap<>();
            item.put("memberId", member.getId());
            item.put("nodeId", member.getNodeId());
            item.put("overlayIp", member.getIp());
            item.put("hub", Objects.equals(member.getHub(), 1));

            Node node = nodeService.getById(member.getNodeId());
            item.put("nodeName", node == null ? "#" + member.getNodeId() : node.getName());
            item.put("nodeOnline", node != null && Objects.equals(node.getStatus(), 1));
            if (node == null || !Objects.equals(node.getStatus(), 1)) {
                item.put("ok", false);
                item.put("error", "节点离线");
                runtimeMembers.add(item);
                continue;
            }

            GostDto result = GostUtil.WgStatus(node.getId(), network.getId().toString());
            if (isGostOperationSuccess(result) && result.getData() != null) {
                JSONObject runtime = (JSONObject) JSONObject.toJSON(result.getData());
                item.put("runtime", runtime);
                item.put("ok", runtime.getBooleanValue("exists") && runtime.getBooleanValue("up"));
            } else {
                item.put("ok", false);
                if (isUnknownCommand(result)) {
                    item.put("error", "节点版本过旧，请先在节点页升级到 1.1.2");
                } else {
                    item.put("error", result == null ? "节点无响应" : result.getMsg());
                }
            }
            runtimeMembers.add(item);
        }

        Map<String, Object> status = new HashMap<>();
        status.put("networkId", id);
        status.put("mode", network.getMode());
        status.put("expectedMembers", members.size());
        status.put("members", runtimeMembers);
        status.put("timestamp", System.currentTimeMillis());
        return R.ok(status);
    }

    /**
     * WSS 模式: 确保每个在线成员的 wstunnel 服务就绪。
     * 中心节点: wstunnel server 监听 27000+networkId, 注入到本机 WG 端口。
     * 分支节点: wstunnel client 把本机 WG 外层包经 ws://中心:port 送到中心。
     * 幂等: 单元不变时不重启, 只保证在跑。
     */
    private void applyWss(WgNetwork network, List<NodeWg> members, List<Integer> applied) {
        int wssPort = 27000 + network.getId().intValue();
        String unitSuffix = "net" + network.getId();
        int wgPort = network.getListenPort() == null ? 51820 : network.getListenPort();

        NodeWg hub = members.stream()
                .filter(m -> m.getHub() != null && m.getHub() == 1)
                .findFirst().orElse(null);
        if (hub == null) {
            log.warn("WSS 模式缺少中心节点 network={}", network.getId());
            return;
        }
        Node hubNode = nodeService.getById(hub.getNodeId());
        if (hubNode == null || hubNode.getServerIp() == null || hubNode.getServerIp().isBlank()) {
            log.warn("WSS 模式中心节点缺少公网地址 network={}", network.getId());
            return;
        }
        String remoteUrl = "ws://" + hubNode.getServerIp() + ":" + wssPort;

        // 中心: server
        try {
            GostDto result = GostUtil.WssEnsure(hubNode.getId(), unitSuffix, "server", wssPort, 0, 0, "");
            if (!isGostOperationSuccess(result)) {
                log.warn("WSS server 下发失败 hub={}: {}", hubNode.getId(),
                        isUnknownCommand(result) ? "节点版本过旧, 请升级到1.4.0" : (result == null ? "节点无响应" : result.getMsg()));
            }
        } catch (Exception e) {
            log.warn("WSS server 下发失败 hub={}: {}", hubNode.getId(), e.getMessage());
        }

        // 分支: client
        for (NodeWg member : members) {
            if (Objects.equals(member.getNodeId(), hub.getNodeId())) continue;
            Node node = nodeService.getById(member.getNodeId());
            if (node == null || node.getStatus() == null || node.getStatus() != 1) continue;
            if (!applied.contains(member.getNodeId())) continue; // 本轮未成功下发配置的节点跳过
            try {
                GostDto result = GostUtil.WssEnsure(node.getId(), unitSuffix, "client", 0, wgPort, wgPort, remoteUrl);
                if (!isGostOperationSuccess(result)) {
                    log.warn("WSS client 下发失败 node={}: {}", node.getId(),
                            isUnknownCommand(result) ? "节点版本过旧, 请升级到1.4.0" : (result == null ? "节点无响应" : result.getMsg()));
                }
            } catch (Exception e) {
                log.warn("WSS client 下发失败 node={}: {}", node.getId(), e.getMessage());
            }
        }
    }

    /**
     * 设置某个成员到对端的出口线路, 并立即在该节点生效。
     * egress: ""=清除策略(跟随系统路由); "auto"=自动故障切换; "lock:ethX"=锁定ethX不自动切换; 其他=指定出口网卡名(带自动切换)。
     */
    @Override
    public R setMemberEgress(Long networkId, Integer nodeId, String egress) {
        WgNetwork network = this.getById(networkId);
        if (network == null) {
            return R.err(ERROR_NETWORK_NOT_FOUND);
        }
        Node node = nodeService.getById(nodeId);
        if (node == null) {
            return R.err(String.format(ERROR_NODE_NOT_FOUND, nodeId));
        }
        NodeWg member = nodeWgMapper.selectOne(new QueryWrapper<NodeWg>()
                .eq("wg_network_id", networkId.intValue()).eq("node_id", nodeId));
        if (member == null) {
            return R.err(ERROR_MEMBER_NOT_FOUND);
        }

        member.setEgress(egress == null ? "" : egress);
        member.setUpdatedTime(System.currentTimeMillis());
        nodeWgMapper.updateById(member);

        String name = network.getId().toString();
        if (member.getEgress().isEmpty()) {
            try {
                GostUtil.WgClearEgress(node.getId(), name);
            } catch (Exception e) {
                log.warn("清除出口策略失败 node={}: {}", node.getId(), e.getMessage());
            }
            return R.ok("已清除出口策略, 恢复跟随系统路由");
        }

        List<String> dests = memberEgressDests(network, members(networkId), member);
        if (dests.isEmpty()) {
            return R.err("该成员没有固定的对端端点(中心节点由分支漫游接入), 无需设置出口");
        }
        String[] ifaceLock = parseEgress(member.getEgress());
        List<String> failed = new ArrayList<>();
        for (String dest : dests) {
            try {
                GostDto result = GostUtil.WgSetEgress(node.getId(), name, dest, ifaceLock[0], Boolean.parseBoolean(ifaceLock[1]));
                if (!isGostOperationSuccess(result)) {
                    failed.add(dest + ": " + (result == null ? "节点无响应" : result.getMsg()));
                }
            } catch (Exception e) {
                failed.add(dest + ": " + e.getMessage());
            }
        }
        if (!failed.isEmpty()) {
            return R.err("出口策略下发失败: " + String.join("; ", failed));
        }
        if (Boolean.parseBoolean(ifaceLock[1])) {
            return R.ok("已锁定出口线路: " + ifaceLock[0] + "(线路故障也不自动切换)");
        }
        return R.ok("出口线路已生效" + (ifaceLock[0].isEmpty() ? "(自动故障切换)" : ": " + ifaceLock[0]));
    }

    /**
     * 解析 node_wg.egress 存储值 → {iface, lock}。
     * ""=未管理; "auto"=自动; "lock:ethX"=锁定; "ethX"=指定网卡。
     */
    private String[] parseEgress(String egress) {
        String value = egress == null ? "" : egress.trim();
        if (value.startsWith("lock:")) {
            return new String[]{value.substring(5), "true"};
        }
        if ("auto".equals(value)) {
            return new String[]{"", "false"};
        }
        return new String[]{value, "false"};
    }

    /** 查询节点的候选出口网卡(供前端下拉选择) */
    @Override
    public R listNodeEgressIfaces(Integer nodeId) {
        Node node = nodeService.getById(nodeId);
        if (node == null) {
            return R.err(String.format(ERROR_NODE_NOT_FOUND, nodeId));
        }
        GostDto result = GostUtil.WgListEgress(nodeId.longValue());
        if (!isGostOperationSuccess(result)) {
            String message = result == null ? "节点无响应" : result.getMsg();
            if (isUnknownCommand(result)) {
                return R.err("节点版本过旧, 请先升级节点到 1.3.0");
            }
            return R.err("读取出口网卡失败: " + message);
        }
        return R.ok(result.getData());
    }

    /**
     * 阶段2.5: 按成员配置把出口线路策略下发到各节点。
     * 只对"有固定对端端点"的成员生效(hub模式分支/mesh成员); 中心节点对分支是漫游端点, 不需要。
     */
    private void applyEgressPolicies(WgNetwork network, List<NodeWg> members) {
        for (NodeWg member : members) {
            if (member.getEgress() == null || member.getEgress().isEmpty()) continue;
            Node node = nodeService.getById(member.getNodeId());
            if (node == null || node.getStatus() == null || node.getStatus() != 1) continue;

            List<String> dests = memberEgressDests(network, members, member);
            if (dests.isEmpty()) continue;
            String[] ifaceLock = parseEgress(member.getEgress());
            String iface = ifaceLock[0];
            boolean lock = Boolean.parseBoolean(ifaceLock[1]);
            for (String dest : dests) {
                try {
                    GostDto result = GostUtil.WgSetEgress(node.getId(), network.getId().toString(), dest, iface, lock);
                    if (!isGostOperationSuccess(result)) {
                        String message = isUnknownCommand(result) ? "节点版本过旧, 请升级到1.4.0"
                                : (result == null ? "节点无响应" : result.getMsg());
                        log.warn("下发出口线路失败 node={} dest={}: {}", node.getId(), dest, message);
                    }
                } catch (Exception e) {
                    log.warn("下发出口线路失败 node={} dest={}: {}", node.getId(), dest, e.getMessage());
                }
            }
        }
    }

    /** 计算某成员需要设置出口的对端endpoint列表 */
    private List<String> memberEgressDests(WgNetwork network, List<NodeWg> members) {
        return memberEgressDests(network, members, null);
    }

    private List<String> memberEgressDests(WgNetwork network, List<NodeWg> members, NodeWg target) {
        NodeWg member = target;
        List<String> dests = new ArrayList<>();
        if ("hub".equals(network.getMode())) {
            if (member != null && member.getHub() != null && member.getHub() == 1) {
                return dests; // 中心节点无固定endpoint
            }
            for (NodeWg other : members) {
                if (other.getHub() != null && other.getHub() == 1) {
                    Node hubNode = nodeService.getById(other.getNodeId());
                    if (hubNode != null && hubNode.getServerIp() != null && !hubNode.getServerIp().isBlank()) {
                        dests.add(hubNode.getServerIp());
                    }
                }
            }
        } else {
            for (NodeWg other : members) {
                if (member != null && Objects.equals(other.getId(), member.getId())) continue;
                Node otherNode = nodeService.getById(other.getNodeId());
                if (otherNode != null && otherNode.getServerIp() != null && !otherNode.getServerIp().isBlank()) {
                    dests.add(otherNode.getServerIp());
                }
            }
        }
        return dests;
    }

    private List<NodeWg> members(Long networkId) {
        return nodeWgMapper.selectList(new QueryWrapper<NodeWg>()
                .eq("wg_network_id", networkId.intValue()).eq("status", 1));
    }

    /**
     * 通用链路探测器只支持 TCP 地址，不能接管 wg:* 的 ICMP 目标。每次组网同步后
     * 重新下发非 WireGuard 探测项，同时清除旧版本误下发到 Agent 的 wg:* 项。
     */
    private void syncTcpProbesWithoutWireGuard(Node node) {
        List<JSONObject> tcpProbes = new ArrayList<>();
        for (LatencyCache.ProbeEntry entry : LatencyCache.getNodeProbes(node.getId())) {
            if (entry.getKey() == null || entry.getAddr() == null || entry.getKey().startsWith("wg:")) continue;
            JSONObject probe = new JSONObject();
            probe.put("key", entry.getKey());
            probe.put("addr", entry.getAddr());
            tcpProbes.add(probe);
        }
        try {
            GostUtil.UpdateProbes(node.getId(), tcpProbes);
        } catch (Exception e) {
            log.warn("清理组网TCP探测项失败 node={}: {}", node.getId(), e.getMessage());
        }
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
            long address = ipv4ToLong(parts[0]);
            long mask = (0xffffffffL << (32 - prefix)) & 0xffffffffL;
            if ((address & mask) != address) {
                return R.err("请填写规范网络地址，例如 10.10.0.0/24");
            }
        } catch (IllegalArgumentException e) {
            return R.err(ERROR_SUBNET_INVALID);
        }
        if (dto.getListenPort() != null && (dto.getListenPort() < 1024 || dto.getListenPort() > 65535)) {
            return R.err(ERROR_PORT_INVALID);
        }
		if (dto.getMtu() != null && (dto.getMtu() < 576 || dto.getMtu() > 9000)) {
			return R.err("MTU 必须在 576-9000 之间");
		}
        if (dto.getMode() != null && !"mesh".equals(dto.getMode()) && !"hub".equals(dto.getMode())) {
            return R.err("mode 仅支持 mesh 或 hub");
        }
        if (dto.getTransport() != null && !"udp".equals(dto.getTransport()) && !"wss".equals(dto.getTransport())) {
            return R.err("transport 仅支持 udp 或 wss");
        }
        if ("wss".equals(dto.getTransport()) && dto.getMode() != null && !"hub".equals(dto.getMode())) {
            return R.err("WSS 封装当前仅支持 Hub 拓扑(分支只连中心, 流量全走TCP)");
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
            md.setEgress(member.getEgress() == null ? "" : member.getEgress());
            md.setApplied(member.getPublicKey() == null || member.getPublicKey().isEmpty() ? 0 : 1);
            md.setLatencies(new java.util.HashMap<>());
            // 该节点到组网内其他节点的延迟
            List<LatencyCache.ProbeEntry> probes = LatencyCache.getNodeProbes(member.getNodeId().longValue());
            if (probes != null) {
                String prefix = "wg:" + network.getId() + ":" + member.getNodeId() + ":";
                for (LatencyCache.ProbeEntry p : probes) {
                    if (p.getKey() != null && p.getKey().startsWith(prefix)) {
                        md.getLatencies().put(p.getKey(), p);
                    }
                }
            }
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

    private R addMembers(WgNetwork network, List<WgMemberDto> members) {
        for (WgMemberDto member : members) {
            if (member.getNodeId() == null) continue;
            R result = addMember(network, member.getNodeId());
            if (result.getCode() != 0) {
                return result;
            }
        }
		applyRequestedHub(network, members);
        return R.ok();
    }

    private R addMember(WgNetwork network, Integer nodeId) {
        Node node = nodeService.getById(nodeId);
        if (node == null) {
            return R.err(String.format(ERROR_NODE_NOT_FOUND, nodeId));
        }
        Integer exists = nodeWgMapper.selectCount(new QueryWrapper<NodeWg>()
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

    private void applyRequestedHub(WgNetwork network, List<WgMemberDto> requestedMembers) {
		List<NodeWg> storedMembers = nodeWgMapper.selectList(new QueryWrapper<NodeWg>()
				.eq("wg_network_id", network.getId()).eq("status", 1).orderByAsc("id"));
		if (storedMembers.isEmpty()) return;

		Integer requestedHubNodeId = null;
		if (requestedMembers != null) {
			for (WgMemberDto member : requestedMembers) {
				if (Objects.equals(member.getHub(), 1) && member.getNodeId() != null) {
					requestedHubNodeId = member.getNodeId();
					break;
				}
			}
		}
		if ("hub".equals(network.getMode()) && requestedHubNodeId == null) {
			requestedHubNodeId = storedMembers.get(0).getNodeId();
		}

		for (NodeWg stored : storedMembers) {
			int desired = "hub".equals(network.getMode()) && Objects.equals(stored.getNodeId(), requestedHubNodeId) ? 1 : 0;
			if (!Objects.equals(stored.getHub(), desired)) {
				stored.setHub(desired);
				stored.setUpdatedTime(System.currentTimeMillis());
				nodeWgMapper.updateById(stored);
			}
		}
    }

    /** 分配组网IP: 从网络地址 + 2 开始，正确支持跨 /24 的网段。 */
    private String allocateIp(WgNetwork network) {
        String[] parts = network.getSubnet().split("/");
        int prefix = Integer.parseInt(parts[1]);
		long address = ipv4ToLong(parts[0]);
		long mask = (0xffffffffL << (32 - prefix)) & 0xffffffffL;
		long networkAddress = address & mask;
		long broadcast = networkAddress | (~mask & 0xffffffffL);

        Set<String> used = new HashSet<>();
        for (NodeWg member : nodeWgMapper.selectList(new QueryWrapper<NodeWg>().eq("wg_network_id", network.getId()))) {
            used.add(member.getIp());
        }

		for (long current = networkAddress + 2; current < broadcast; current++) {
			String candidate = longToIpv4(current);
            if (!used.contains(candidate)) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * 自动分配不重复的组网网段: 从 10.10.0.0/16 中逐个尝试 /24,
     * 跳过与任何既有组网网段重叠的候选, 避免同宿主机多张 WG 接口路由冲突。
     */
    private String allocateSubnet() {
        List<WgNetwork> networks = this.list();
        long base = ipv4ToLong("10.10.0.0");
        for (long n = 0; n < 256; n++) {
            long candidate = base + (n << 8);
            if (!subnetRangeConflicts(candidate, 24, networks)) {
                return longToIpv4(candidate) + "/24";
            }
        }
        return null;
    }

    /** 自动分配监听端口: 从 51820 起取第一个未被其他组网占用的端口。 */
    private Integer allocateListenPort() {
        Set<Integer> used = new HashSet<>();
        for (WgNetwork network : this.list()) {
            if (network.getListenPort() != null) {
                used.add(network.getListenPort());
            }
        }
        for (int port = 51820; port <= 65535; port++) {
            if (!used.contains(port)) {
                return port;
            }
        }
        return null;
    }

    /** 判断候选网段 [network, broadcast] 是否与任何既有组网网段重叠 */
    private boolean subnetRangeConflicts(long candidateNetwork, int candidatePrefix, List<WgNetwork> networks) {
        long candidateMask = (0xffffffffL << (32 - candidatePrefix)) & 0xffffffffL;
        long candidateStart = candidateNetwork & candidateMask;
        long candidateEnd = candidateStart | (~candidateMask & 0xffffffffL);
        for (WgNetwork network : networks) {
            if (network.getSubnet() == null) continue;
            String[] parts = network.getSubnet().split("/");
            if (parts.length != 2) continue;
            try {
                long address = ipv4ToLong(parts[0]);
                int prefix = Integer.parseInt(parts[1].trim());
                if (prefix < 0 || prefix > 32) continue;
                long mask = (0xffffffffL << (32 - prefix)) & 0xffffffffL;
                long start = address & mask;
                long end = start | (~mask & 0xffffffffL);
                if (candidateStart <= end && start <= candidateEnd) {
                    return true;
                }
            } catch (IllegalArgumentException ignored) {
                // 无法解析的网段(NumberFormatException为其子类)不参与冲突判断
            }
        }
        return false;
    }

	private long ipv4ToLong(String value) {
		String[] octets = value.split("\\.", -1);
		if (octets.length != 4) throw new IllegalArgumentException("invalid ipv4");
		long result = 0;
		for (String octet : octets) {
			if (octet.isEmpty()) throw new IllegalArgumentException("invalid ipv4");
			int part;
			try {
				part = Integer.parseInt(octet);
			} catch (NumberFormatException e) {
				throw new IllegalArgumentException("invalid ipv4", e);
			}
			if (part < 0 || part > 255) throw new IllegalArgumentException("invalid ipv4");
			result = (result << 8) | part;
		}
		return result;
	}

	private String longToIpv4(long value) {
		return ((value >> 24) & 0xff) + "." + ((value >> 16) & 0xff) + "." +
				((value >> 8) & 0xff) + "." + (value & 0xff);
	}

    /** 阶段1请求: 本机参数 */
    private JSONObject buildBaseRequest(WgNetwork network, NodeWg member) {
        JSONObject req = new JSONObject();
        req.put("name", network.getId().toString());
        req.put("address", member.getIp() + "/" + network.getSubnet().split("/")[1]);
        req.put("listenPort", getListenPort(network, member));
        req.put("mtu", network.getMtu() == null ? 1420 : network.getMtu());
		req.put("forwarding", false);
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
		req.put("forwarding", "hub".equals(network.getMode()) && Objects.equals(member.getHub(), 1));

        JSONArray peers = new JSONArray();
        if ("mesh".equals(network.getMode())) {
            for (NodeWg other : members) {
                if (Objects.equals(other.getId(), member.getId())) continue;
                if (other.getPublicKey() == null) continue;
                Node node = nodeService.getById(other.getNodeId());
                if (node == null) continue;
                JSONObject peer = buildPeer(other.getPublicKey(),
						formatEndpoint(node.getServerIp(), network.getListenPort()),
						java.util.Collections.singletonList(other.getIp() + "/32"),
						other.getIp());
                peers.add(peer);
            }
        } else {
            // hub模式: 非中心只连中心; 中心连所有
            if (member.getHub() != null && member.getHub() == 1) {
                for (NodeWg other : members) {
                    if (Objects.equals(other.getId(), member.getId())) continue;
                    if (other.getPublicKey() == null) continue;
                    // 分支不监听固定端口，由其主动握手后让 hub 学习 endpoint。
                    JSONObject peer = buildPeer(other.getPublicKey(),
							"", java.util.Collections.singletonList(other.getIp() + "/32"),
							other.getIp());
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
                        // WSS 模式: 分支的 WG 外层包发给本机 wstunnel 客户端, 经TCP送到中心
                        String epHost = "wss".equals(network.getTransport()) ? "127.0.0.1" : hubNode.getServerIp();
                        JSONObject peer = buildPeer(hub.getPublicKey(),
								formatEndpoint(epHost, network.getListenPort()),
								java.util.Collections.singletonList(network.getSubnet()),
								hub.getIp());
                        peers.add(peer);
                    }
                }
            }
        }
        req.put("peers", peers);
        return req;
    }

    private JSONObject buildPeer(String publicKey, String endpoint, List<String> allowedIpValues, String wgIp) {
        JSONObject peer = new JSONObject();
        peer.put("publicKey", publicKey);
        peer.put("endpoint", endpoint);
        JSONArray allowedIps = new JSONArray();
		allowedIps.addAll(allowedIpValues);
        peer.put("allowedIps", allowedIps);
        peer.put("persistentKeepalive", KEEPALIVE);
        if (wgIp != null) {
            peer.put("wgIp", wgIp);
        }
        return peer;
    }

	private String formatEndpoint(String host, Integer port) {
		if (host == null) return "";
		host = host.trim();
		if (host.startsWith("[") && host.endsWith("]")) {
			return host + ":" + port;
		}
		if (host.contains(":")) {
			return "[" + host + "]:" + port;
		}
		return host + ":" + port;
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

	private boolean isUnknownCommand(GostDto gostResult) {
		if (gostResult == null || gostResult.getMsg() == null) return false;
		String message = gostResult.getMsg().toLowerCase();
		return message.contains("unknown") || message.contains("未知命令");
	}

}

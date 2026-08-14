package com.admin.service.impl;

import com.admin.common.dto.GostDto;
import com.admin.common.dto.LinkDto;
import com.admin.common.dto.LinkListDto;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.LatencyCache;
import com.admin.common.utils.WebSocketServer;
import com.admin.entity.*;
import com.admin.mapper.*;
import com.admin.service.ForwardService;
import com.admin.service.LinkService;
import com.admin.service.NodeService;
import com.alibaba.fastjson.JSON;
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
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * <p>
 * 线路服务实现类
 * 线路: 入口 -> [中间节点...] -> 出口(落地)
 * 每个非入口节点运行一个中继(relay)监听服务, 入口节点通过链(chain)串联
 * </p>
 */
@Slf4j
@Service
public class LinkServiceImpl extends ServiceImpl<LinkMapper, Link> implements LinkService {

    private static final String GOST_SUCCESS_MSG = "OK";
    private static final String GOST_NOT_FOUND_MSG = "not found";

    private static final String ERROR_LINK_NOT_FOUND = "线路不存在";
    private static final String ERROR_NODE_OFFLINE = "节点 %s 不在线";
    private static final String ERROR_NODE_NOT_FOUND = "节点不存在: %d";
    private static final String ERROR_WG_NOT_FOUND = "组网不存在";
    private static final String ERROR_WG_NODE_NOT_MEMBER = "节点 %s 不在组网 %s 中";
    private static final String ERROR_WG_REQUIRED = "transport=wg 时必须选择组网";
    private static final String ERROR_LINK_IN_GROUP = "线路正在被负载均衡组使用, 请先从组中移除";
    private static final String ERROR_PORT_FULL = "节点 %s 的可分配端口已用尽";

    @Resource
    private NodeService nodeService;

    @Resource
    private LinkRelayMapper linkRelayMapper;

    @Resource
    private NodeWgMapper nodeWgMapper;

    @Resource
    private WgNetworkMapper wgNetworkMapper;

    @Resource
    private GroupLinkMapper groupLinkMapper;

    @Resource
    private ForwardMapper forwardMapper;

    @Resource
    @Lazy
    private ForwardService forwardService;

    @Override
    public R createLink(LinkDto linkDto) {
        List<Integer> nodeOrder = buildNodeOrder(linkDto);
        R validateResult = validateLink(linkDto, nodeOrder);
        if (validateResult.getCode() != 0) {
            return validateResult;
        }

        Link link = new Link();
        BeanUtils.copyProperties(linkDto, link);
        link.setHopNodeIds(JSON.toJSONString(linkDto.getHopNodeIds() == null ? new ArrayList<>() : linkDto.getHopNodeIds()));
        long now = System.currentTimeMillis();
        link.setCreatedTime(now);
        link.setUpdatedTime(now);
        link.setStatus(1);

        if (!this.save(link)) {
            return R.err("线路创建失败");
        }

        R relayResult = createRelays(link, nodeOrder);
        if (relayResult.getCode() != 0) {
            this.removeById(link.getId());
            return relayResult;
        }

        R chainResult = deployChain(link);
        if (chainResult.getCode() != 0) {
            removeLinkConfig(link.getId());
            this.removeById(link.getId());
            return chainResult;
        }

        return R.ok();
    }

    @Override
    public R getAllLinks() {
        List<LinkListDto> links = baseMapper.selectAllLinks();
        for (LinkListDto dto : links) {
            dto.setLatencies(new java.util.HashMap<>());
            // 入口节点对各中继点的延迟
            List<LatencyCache.ProbeEntry> probes = LatencyCache.getNodeProbes(dto.getEntryNodeId() == null ? null : dto.getEntryNodeId().longValue());
            if (probes != null) {
                for (LatencyCache.ProbeEntry p : probes) {
                    if (p.getKey() != null && p.getKey().startsWith("link:" + dto.getId() + ":")) {
                        dto.getLatencies().put(p.getKey(), p);
                    }
                }
            }
        }
        return R.ok(links);
    }

    @Override
    public R updateLink(Long id, LinkDto linkDto) {
        Link link = this.getById(id);
        if (link == null) {
            return R.err(ERROR_LINK_NOT_FOUND);
        }

        List<Integer> nodeOrder = buildNodeOrder(linkDto);
        R validateResult = validateLink(linkDto, nodeOrder);
        if (validateResult.getCode() != 0) {
            return validateResult;
        }

        // 删除旧中继
        List<LinkRelay> oldRelays = getLinkRelays(id);
        for (LinkRelay relay : oldRelays) {
            try {
                GostUtil.DeleteRelayService(relay.getNodeId().longValue(), buildRelayName(id, relay.getNodeId()));
            } catch (Exception e) {
                log.warn("删除旧中继失败: {}", e.getMessage());
            }
        }
        linkRelayMapper.delete(new QueryWrapper<LinkRelay>().eq("link_id", id));

        BeanUtils.copyProperties(linkDto, link);
        link.setId(id);
        link.setHopNodeIds(JSON.toJSONString(linkDto.getHopNodeIds() == null ? new ArrayList<>() : linkDto.getHopNodeIds()));
        link.setUpdatedTime(System.currentTimeMillis());
        this.updateById(link);

        R relayResult = createRelays(link, nodeOrder);
        if (relayResult.getCode() != 0) {
            return relayResult;
        }

        R chainResult = deployChain(link);
        if (chainResult.getCode() != 0) {
            return chainResult;
        }

        // 重新下发使用该线路的组的所有转发
        List<GroupLink> groupLinks = groupLinkMapper.selectList(new QueryWrapper<GroupLink>().eq("link_id", id).eq("status", 1));
        Set<Integer> groupIds = new HashSet<>();
        for (GroupLink gl : groupLinks) {
            groupIds.add(gl.getGroupId());
        }
        for (Integer groupId : groupIds) {
            forwardService.redeployGroup(groupId.longValue());
        }

        return R.ok();
    }

    @Override
    public R deleteLink(Long id) {
        Link link = this.getById(id);
        if (link == null) {
            return R.err(ERROR_LINK_NOT_FOUND);
        }

        Long groupCount = groupLinkMapper.selectCount(new QueryWrapper<GroupLink>().eq("link_id", id).eq("status", 1));
        if (groupCount != null && groupCount > 0) {
            return R.err(ERROR_LINK_IN_GROUP);
        }

        removeLinkConfig(id);

        linkRelayMapper.delete(new QueryWrapper<LinkRelay>().eq("link_id", id));
        this.removeById(id);
        return R.ok();
    }

    @Override
    public R redeployLink(Long id) {
        Link link = this.getById(id);
        if (link == null) {
            return R.err(ERROR_LINK_NOT_FOUND);
        }

        R chainResult = deployChain(link);
        if (chainResult.getCode() != 0) {
            return chainResult;
        }

        List<LinkRelay> relays = getLinkRelays(id);
        for (LinkRelay relay : relays) {
            GostDto result = GostUtil.AddRelayService(relay.getNodeId().longValue(),
                    buildRelayName(id, relay.getNodeId()), relay.getAddr() + ":" + relay.getPort(), relay.getProtocol());
            if (!isGostOperationSuccess(result)) {
                log.warn("重发中继服务失败 link={} node={}: {}", id, relay.getNodeId(), result.getMsg());
            }
        }
        return R.ok();
    }

    @Override
    public void removeLinkConfig(Long id) {
        Link link = this.getById(id);
        List<LinkRelay> relays = getLinkRelays(id);
        for (LinkRelay relay : relays) {
            try {
                GostUtil.DeleteRelayService(relay.getNodeId().longValue(), buildRelayName(id, relay.getNodeId()));
            } catch (Exception e) {
                log.warn("删除中继服务失败: {}", e.getMessage());
            }
        }
        if (link != null) {
            try {
                GostUtil.DeleteChains(link.getEntryNodeId().longValue(), buildChainName(id));
            } catch (Exception e) {
                log.warn("删除链失败: {}", e.getMessage());
            }
        }
    }

    @Override
    public List<LinkRelay> getLinkRelays(Long linkId) {
        return linkRelayMapper.selectList(new QueryWrapper<LinkRelay>().eq("link_id", linkId).eq("status", 1));
    }

    @Override
    public JSONObject buildChainConfig(Link link) {
        List<String> hopAddrs = new ArrayList<>();
        List<String> probeAddrs = new ArrayList<>();
        List<Integer> nodeOrder = getNodeOrder(link);
        List<LinkRelay> relays = getLinkRelays(link.getId());

        // 非入口节点按顺序: [中间节点..., 出口节点]
        for (int i = 1; i < nodeOrder.size(); i++) {
            Integer nodeId = nodeOrder.get(i);
            LinkRelay relay = findRelay(relays, nodeId);
            if (relay == null) continue;
            String addr = relay.getAddr() + ":" + relay.getPort();
            if (relay.getAddr().contains(":")) {
                addr = "[" + relay.getAddr() + "]:" + relay.getPort();
            }
            hopAddrs.add(addr);
            probeAddrs.add(addr);
        }

        String hopProtocol = "tcp";
        if ("tls".equals(link.getTransport())) {
            hopProtocol = "tls";
        }

        return GostUtil.buildChainJson(buildChainName(link.getId()), hopAddrs, hopProtocol, probeAddrs);
    }

    // ==================== 内部方法 ====================

    /** 创建中继服务并保存记录 */
    private R createRelays(Link link, List<Integer> nodeOrder) {
        List<LinkRelay> newRelays = new ArrayList<>();
        for (int i = 1; i < nodeOrder.size(); i++) {
            Integer nodeId = nodeOrder.get(i);
            Node node = nodeService.getById(nodeId);
            if (node == null) {
                return R.err(String.format(ERROR_NODE_NOT_FOUND, nodeId));
            }
            if (node.getStatus() == null || node.getStatus() != 1) {
                return R.err(String.format(ERROR_NODE_OFFLINE, node.getName()));
            }

            Integer port = allocateRelayPort(nodeId, link.getId());
            if (port == null) {
                return R.err(String.format(ERROR_PORT_FULL, node.getName()));
            }

            String bindAddr = "0.0.0.0";
            String protocol = "tcp";
            if ("wg".equals(link.getTransport())) {
                NodeWg nw = getNodeWg(link.getWgNetworkId(), nodeId);
                if (nw == null) {
                    return R.err(String.format("节点 %s 不在组网中, 请先同步组网", node.getName()));
                }
                bindAddr = nw.getIp();
                protocol = "tcp";
            } else if ("tls".equals(link.getTransport())) {
                protocol = "tls";
            }

            LinkRelay relay = new LinkRelay();
            relay.setLinkId(link.getId().intValue());
            relay.setNodeId(nodeId);
            relay.setPort(port);
            relay.setAddr(bindAddr);
            relay.setProtocol(protocol);
            long now = System.currentTimeMillis();
            relay.setCreatedTime(now);
            relay.setUpdatedTime(now);
            relay.setStatus(1);
            linkRelayMapper.insert(relay);
            newRelays.add(relay);

            GostDto result = GostUtil.AddRelayService(nodeId.longValue(),
                    buildRelayName(link.getId(), nodeId), relay.getAddr() + ":" + relay.getPort(), protocol);
            if (!isGostOperationSuccess(result)) {
                for (LinkRelay created : newRelays) {
                    try {
                        GostUtil.DeleteRelayService(created.getNodeId().longValue(),
                                buildRelayName(link.getId(), created.getNodeId()));
                    } catch (Exception ignored) {
                    }
                    linkRelayMapper.deleteById(created.getId());
                }
                return R.err("中继服务创建失败: " + result.getMsg());
            }
        }
        return R.ok();
    }

    /** 下发链到入口节点 */
    private R deployChain(Link link) {
        Node entry = nodeService.getById(link.getEntryNodeId());
        if (entry == null) {
            return R.err(String.format(ERROR_NODE_NOT_FOUND, link.getEntryNodeId()));
        }
        if (entry.getStatus() == null || entry.getStatus() != 1) {
            return R.err(String.format(ERROR_NODE_OFFLINE, entry.getName()));
        }

        JSONObject chainConfig = buildChainConfig(link);
        GostDto result = GostUtil.UpdateChains(entry.getId(), chainConfig);
        if (result.getMsg().contains(GOST_NOT_FOUND_MSG)) {
            result = GostUtil.AddChains(entry.getId(), chainConfig);
        }
        return isGostOperationSuccess(result) ? R.ok() : R.err("链创建失败: " + result.getMsg());
    }

    /** 校验线路合法性 */
    private R validateLink(LinkDto linkDto, List<Integer> nodeOrder) {
        if (nodeOrder.size() < 2) {
            return R.err("线路至少需要入口和出口两个节点(单节点请使用直连模式)");
        }
        Set<Integer> unique = new HashSet<>(nodeOrder);
        if (unique.size() != nodeOrder.size()) {
            return R.err("线路中不能包含重复节点");
        }

        for (Integer nodeId : nodeOrder) {
            Node node = nodeService.getById(nodeId);
            if (node == null) {
                return R.err(String.format(ERROR_NODE_NOT_FOUND, nodeId));
            }
        }

        if ("wg".equals(linkDto.getTransport())) {
            if (linkDto.getWgNetworkId() == null) {
                return R.err(ERROR_WG_REQUIRED);
            }
            WgNetwork wg = wgNetworkMapper.selectById(linkDto.getWgNetworkId());
            if (wg == null) {
                return R.err(ERROR_WG_NOT_FOUND);
            }
            for (Integer nodeId : nodeOrder) {
                NodeWg nw = getNodeWg(linkDto.getWgNetworkId(), nodeId);
                if (nw == null) {
                    Node node = nodeService.getById(nodeId);
                    return R.err(String.format(ERROR_WG_NODE_NOT_MEMBER,
                            node == null ? String.valueOf(nodeId) : node.getName(), wg.getName()));
                }
            }
        }
        return R.ok();
    }

    private List<Integer> buildNodeOrder(LinkDto linkDto) {
        List<Integer> order = new ArrayList<>();
        order.add(linkDto.getEntryNodeId());
        if (linkDto.getHopNodeIds() != null) {
            order.addAll(linkDto.getHopNodeIds());
        }
        if (!Objects.equals(linkDto.getEntryNodeId(), linkDto.getExitNodeId())) {
            order.add(linkDto.getExitNodeId());
        }
        return order;
    }

    private List<Integer> getNodeOrder(Link link) {
        List<Integer> order = new ArrayList<>();
        order.add(link.getEntryNodeId());
        if (link.getHopNodeIds() != null && !link.getHopNodeIds().isEmpty() && !"[]".equals(link.getHopNodeIds())) {
            JSONArray arr = JSON.parseArray(link.getHopNodeIds());
            for (int i = 0; i < arr.size(); i++) {
                order.add(arr.getInteger(i));
            }
        }
        if (!Objects.equals(link.getEntryNodeId(), link.getExitNodeId())) {
            order.add(link.getExitNodeId());
        }
        return order;
    }

    private LinkRelay findRelay(List<LinkRelay> relays, Integer nodeId) {
        for (LinkRelay relay : relays) {
            if (Objects.equals(relay.getNodeId(), nodeId)) {
                return relay;
            }
        }
        return null;
    }

    private NodeWg getNodeWg(Integer wgNetworkId, Integer nodeId) {
        return nodeWgMapper.selectOne(new QueryWrapper<NodeWg>()
                .eq("wg_network_id", wgNetworkId)
                .eq("node_id", nodeId)
                .eq("status", 1));
    }

    /** 在节点端口范围内分配中继端口 */
    private Integer allocateRelayPort(Integer nodeId, Long excludeLinkId) {
        Node node = nodeService.getById(nodeId);
        if (node == null || node.getPortSta() == null || node.getPortEnd() == null) {
            return null;
        }
        Set<Integer> used = new HashSet<>();

        // 该节点作为入口的转发端口
        Set<Integer> entryNodes = new HashSet<>();
        for (GroupLink gl : groupLinkMapper.selectList(new QueryWrapper<GroupLink>().eq("status", 1))) {
            Link link = this.getById(gl.getLinkId());
            if (link != null) {
                entryNodes.add(link.getEntryNodeId());
            }
        }
        if (entryNodes.contains(nodeId)) {
            for (Forward f : forwardMapper.selectList(new QueryWrapper<Forward>().eq("status", 1))) {
                used.add(f.getInPort());
            }
        }

        QueryWrapper<LinkRelay> qw = new QueryWrapper<LinkRelay>().eq("node_id", nodeId);
        if (excludeLinkId != null) {
            qw.ne("link_id", excludeLinkId);
        }
        for (LinkRelay relay : linkRelayMapper.selectList(qw)) {
            used.add(relay.getPort());
        }
        for (int port = node.getPortSta(); port <= node.getPortEnd(); port++) {
            if (!used.contains(port)) {
                return port;
            }
        }
        return null;
    }

    public static String buildRelayName(Long linkId, Integer nodeId) {
        return "R" + linkId + "_" + nodeId;
    }

    public static String buildChainName(Long linkId) {
        return "L" + linkId;
    }

    private boolean isGostOperationSuccess(GostDto gostResult) {
        return gostResult != null && Objects.equals(gostResult.getMsg(), GOST_SUCCESS_MSG);
    }

}

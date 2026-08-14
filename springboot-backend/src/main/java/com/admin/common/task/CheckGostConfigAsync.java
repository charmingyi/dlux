package com.admin.common.task;

import com.admin.common.dto.*;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.entity.*;
import com.admin.mapper.LinkRelayMapper;
import com.admin.mapper.NodeWgMapper;
import com.admin.service.*;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * 节点配置快照上报后的孤儿配置清理
 * 仅清理明确的孤儿项, 避免误删共享的中继/链配置
 */
@Slf4j
@Service
public class CheckGostConfigAsync {

    @Resource
    private NodeService nodeService;

    @Resource
    @Lazy
    private ForwardService forwardService;

    @Resource
    @Lazy
    private LinkService linkService;

    @Resource
    @Lazy
    private SpeedLimitService speedLimitService;

    @Resource
    private LinkRelayMapper linkRelayMapper;

    /**
     * 清理孤立的配置项
     */
    @Async
    public void cleanNodeConfigs(Long nodeId, GostConfigDto gostConfig) {
        Node node = nodeService.getById(nodeId);
        if (node == null) return;

        cleanOrphanedServices(gostConfig, node);
        cleanOrphanedLimiters(gostConfig, node);
    }

    /**
     * 清理孤立的服务(F*转发入口 / R*中继)
     */
    private void cleanOrphanedServices(GostConfigDto gostConfig, Node node) {
        if (gostConfig.getServices() == null) return;

        for (ConfigItem service : gostConfig.getServices()) {
            safeExecute(() -> {
                String name = service.getName();
                if (name == null || name.isEmpty() || "web_api".equals(name)) return;

                boolean expected = false;
                if (name.startsWith("F") && name.endsWith("_tcp")) {
                    String forwardId = name.substring(1, name.length() - 4);
                    Forward forward = forwardService.getById(forwardId);
                    if (forward != null) {
                        // 该转发的入口节点必须与当前节点一致
                        Integer entryNodeId = getForwardEntryNode(forward);
                        expected = entryNodeId != null && Objects.equals(entryNodeId.longValue(), node.getId());
                    }
                } else if (name.startsWith("R")) {
                    // R{linkId}_{nodeId}
                    String[] parts = name.split("_");
                    if (parts.length == 2) {
                        Long linkId = parseLongSafe(parts[0].substring(1));
                        if (linkId != null) {
                            Long count = linkRelayMapper.selectCount(new QueryWrapper<LinkRelay>()
                                    .eq("link_id", linkId).eq("node_id", parts[1]).eq("status", 1));
                            expected = count != null && count > 0;
                        }
                    }
                } else {
                    return; // 未知服务名不处理
                }

                if (!expected) {
                    log.info("删除孤立的服务: {} (节点: {})", name, node.getId());
                    if (name.endsWith("_udp") || name.endsWith("_tcp")) {
                        String base = name.substring(0, name.lastIndexOf('_'));
                        GostUtil.DeleteService(node.getId(), base);
                    } else {
                        GostUtil.DeleteRelayService(node.getId(), name);
                    }
                }
            }, "清理服务 " + service.getName());
        }
    }

    /**
     * 清理孤立的限流器
     */
    private void cleanOrphanedLimiters(GostConfigDto gostConfig, Node node) {
        if (gostConfig.getLimiters() == null) return;

        for (ConfigItem limiter : gostConfig.getLimiters()) {
            safeExecute(() -> {
                Long id = parseLongSafe(limiter.getName());
                if (id == null) return;
                SpeedLimit speedLimit = speedLimitService.getById(id);
                if (speedLimit == null || speedLimit.getStatus() == null || speedLimit.getStatus() != 1) {
                    log.info("删除孤立的限流器: {} (节点: {})", limiter.getName(), node.getId());
                    GostUtil.DeleteLimiters(node.getId(), id);
                }
            }, "清理限流器 " + limiter.getName());
        }
    }

    private Integer getForwardEntryNode(Forward forward) {
        if (forward.getGroupId() == null) return null;
        List<com.admin.entity.GroupLink> gls = getGroupLinks(forward.getGroupId());
        if (gls == null || gls.isEmpty()) return null;
        Link link = linkService.getById(gls.get(0).getLinkId());
        return link == null ? null : link.getEntryNodeId();
    }

    @javax.annotation.Resource
    private com.admin.mapper.GroupLinkMapper groupLinkMapper;

    private List<com.admin.entity.GroupLink> getGroupLinks(Integer groupId) {
        return groupLinkMapper.selectList(new QueryWrapper<com.admin.entity.GroupLink>()
                .eq("group_id", groupId).eq("status", 1).orderByAsc("inx"));
    }

    private Long parseLongSafe(String value) {
        try {
            return Long.parseLong(value);
        } catch (Exception e) {
            return null;
        }
    }

    private void safeExecute(Runnable operation, String operationDesc) {
        try {
            operation.run();
        } catch (Exception e) {
            log.info("执行操作失败: {}", operationDesc, e);
        }
    }

}

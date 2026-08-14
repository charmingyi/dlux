package com.admin.common.task;

import com.admin.common.utils.GostUtil;
import com.admin.common.utils.LatencyCache;
import com.admin.entity.Node;
import com.admin.service.NodeService;
import com.admin.service.WgNetworkService;
import com.alibaba.fastjson.JSONObject;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

import javax.annotation.Resource;
import java.util.List;

/**
 * 周期同步任务:
 *  - 重发各节点的探测配置(节点重启/断连后恢复)
 *  - 重同步组网(配置指纹一致时节点端自动跳过)
 */
@Slf4j
@Configuration
@EnableScheduling
public class ProbeSyncTask {

    @Resource
    private NodeService nodeService;

    @Resource
    private WgNetworkService wgNetworkService;

    @Scheduled(fixedDelay = 180000)
    public void syncAll() {
        syncProbes();
        syncWgNetworks();
    }

    private void syncProbes() {
        List<Node> nodes = nodeService.list(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Node>().eq("status", 1));
        for (Node node : nodes) {
            try {
                List<LatencyCache.ProbeEntry> probes = LatencyCache.getNodeProbes(node.getId());
                if (probes.isEmpty()) continue;
                java.util.List<JSONObject> list = new java.util.ArrayList<>();
                for (LatencyCache.ProbeEntry entry : probes) {
                    // WireGuard 组网使用专用 ICMP PingIps 探测。若把 wg:* 下发给
                    // 通用探测器，它会按 TCP 地址探测并覆盖正确的 ICMP 结果。
                    if (entry.getKey() != null && entry.getKey().startsWith("wg:")) continue;
                    JSONObject probe = new JSONObject();
                    probe.put("key", entry.getKey());
                    probe.put("addr", entry.getAddr());
                    list.add(probe);
                }
                GostUtil.UpdateProbes(node.getId(), list);
            } catch (Exception e) {
                log.warn("重发探测配置失败 node={}: {}", node.getId(), e.getMessage());
            }
        }
    }

    private void syncWgNetworks() {
        List<com.admin.entity.WgNetwork> networks = wgNetworkService.list(
                new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<com.admin.entity.WgNetwork>().eq("status", 1));
        for (com.admin.entity.WgNetwork network : networks) {
            try {
                wgNetworkService.syncNetwork(network.getId());
            } catch (Exception e) {
                log.warn("重同步组网失败 network={}: {}", network.getId(), e.getMessage());
            }
        }
    }

}

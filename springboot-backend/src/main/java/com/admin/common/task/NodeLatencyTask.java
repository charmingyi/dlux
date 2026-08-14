package com.admin.common.task;

import com.admin.common.dto.GostDto;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.LatencyCache;
import com.admin.common.utils.WebSocketServer;
import com.admin.entity.Node;
import com.admin.service.NodeService;
import com.alibaba.fastjson.JSONObject;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

import javax.annotation.Resource;
import java.util.List;

/**
 * 面板到节点延迟探测: 每30秒对在线节点执行Ping, 结果广播给前端
 */
@Slf4j
@Configuration
@EnableScheduling
public class NodeLatencyTask {

    @Resource
    private NodeService nodeService;

    @Scheduled(fixedDelay = 30000)
    public void probeNodeLatency() {
        List<Node> nodes = nodeService.list(new com.baomidou.mybatisplus.core.conditions.query.QueryWrapper<Node>().eq("status", 1));
        for (Node node : nodes) {
            try {
                long start = System.currentTimeMillis();
                GostDto result = GostUtil.Ping(node.getId());
                if (result != null && "OK".equals(result.getMsg())) {
                    long latency = System.currentTimeMillis() - start;
                    LatencyCache.updateNodeLatency(node.getId(), latency);

                    JSONObject broadcast = new JSONObject();
                    broadcast.put("id", node.getId().toString());
                    broadcast.put("type", "latency");
                    broadcast.put("data", latency);
                    WebSocketServer.broadcastMessage(broadcast.toJSONString());
                } else {
                    LatencyCache.updateNodeLatency(node.getId(), null);
                }
            } catch (Exception e) {
                log.warn("节点延迟探测失败 node={}: {}", node.getId(), e.getMessage());
            }
        }
    }

}

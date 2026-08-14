package com.admin.common.utils;

import lombok.Data;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 延迟/探测结果缓存
 *
 *  - 节点延迟: 面板定时Ping节点得到的RTT
 *  - 链路探测: 节点侧对中继端点/目标地址的TCP探测结果
 */
public class LatencyCache {

    @Data
    public static class ProbeEntry {
        private String key;
        private String addr;
        private double ms;
        private boolean up;
        private long ts;
    }

    /** nodeId -> 面板到节点延迟(ms) */
    private static final ConcurrentHashMap<Long, Long> NODE_LATENCY = new ConcurrentHashMap<>();

    /** nodeId -> (key -> 探测结果) */
    private static final ConcurrentHashMap<Long, ConcurrentHashMap<String, ProbeEntry>> PROBES = new ConcurrentHashMap<>();

    private LatencyCache() {
    }

    // ==================== 节点延迟 ====================

    public static void updateNodeLatency(Long nodeId, Long ms) {
        if (nodeId == null) return;
        if (ms == null) {
            NODE_LATENCY.remove(nodeId);
        } else {
            NODE_LATENCY.put(nodeId, ms);
        }
    }

    public static Long getNodeLatency(Long nodeId) {
        return NODE_LATENCY.get(nodeId);
    }

    public static Map<Long, Long> getAllNodeLatency() {
        return NODE_LATENCY;
    }

    // ==================== 链路探测 ====================

    public static void updateProbes(Long nodeId, List<ProbeEntry> results) {
        if (nodeId == null || results == null || results.isEmpty()) return;
        ConcurrentHashMap<String, ProbeEntry> map = PROBES.computeIfAbsent(nodeId, k -> new ConcurrentHashMap<>());
        for (ProbeEntry entry : results) {
            if (entry.getKey() == null) continue;
            map.put(entry.getKey(), entry);
        }
    }

    public static ProbeEntry getProbe(Long nodeId, String key) {
        if (nodeId == null || key == null) return null;
        ConcurrentHashMap<String, ProbeEntry> map = PROBES.get(nodeId);
        if (map == null) return null;
        return map.get(key);
    }

    public static List<ProbeEntry> getNodeProbes(Long nodeId) {
        if (nodeId == null) return new ArrayList<>();
        ConcurrentHashMap<String, ProbeEntry> map = PROBES.get(nodeId);
        if (map == null) return new ArrayList<>();
        return new ArrayList<>(map.values());
    }

}

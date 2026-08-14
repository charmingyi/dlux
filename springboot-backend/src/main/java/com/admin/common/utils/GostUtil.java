package com.admin.common.utils;

import com.admin.common.dto.GostDto;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import org.apache.commons.lang3.StringUtils;

import java.util.List;
import java.util.Objects;

/**
 * 节点配置生成工具
 *
 * 服务命名约定:
 *  - 转发入口服务:  F{forwardId}_tcp / F{forwardId}_udp
 *  - 线路链:        L{linkId}
 *  - 线路中继服务:  R{linkId}_{nodeId}
 *  - 限速器:        {speedId}
 */
public class GostUtil {

    // ==================== 限速器 ====================

    public static GostDto AddLimiters(Long node_id, Long name, String speed) {
        JSONObject data = createLimiterData(name, speed);
        return WebSocketServer.send_msg(node_id, data, "AddLimiters");
    }

    public static GostDto UpdateLimiters(Long node_id, Long name, String speed) {
        JSONObject data = createLimiterData(name, speed);
        JSONObject req = new JSONObject();
        req.put("limiter", name + "");
        req.put("data", data);
        return WebSocketServer.send_msg(node_id, req, "UpdateLimiters");
    }

    public static GostDto DeleteLimiters(Long node_id, Long name) {
        JSONObject req = new JSONObject();
        req.put("limiter", name + "");
        return WebSocketServer.send_msg(node_id, req, "DeleteLimiters");
    }

    // ==================== 转发入口服务 ====================

    /**
     * 创建入口服务(tcp+udp)
     *
     * @param chainGroupNames 线路链名称列表(负载均衡)
     * @param groupStrategy   组策略 round/random/fifo/hash/latency
     * @param maxFails        失败次数
     * @param failTimeout     恢复时间
     */
    public static GostDto AddService(Long node_id, String name, Integer in_port, Integer limiter,
                                     String remoteAddr, String targetStrategy,
                                     List<String> chainGroupNames, String groupStrategy,
                                     Integer maxFails, String failTimeout, String interfaceName) {
        JSONArray services = new JSONArray();
        String[] protocols = {"tcp", "udp"};
        for (String protocol : protocols) {
            JSONObject service = createServiceConfig(name, in_port, limiter, remoteAddr, protocol,
                    targetStrategy, chainGroupNames, groupStrategy, maxFails, failTimeout, interfaceName);
            services.add(service);
        }
        return WebSocketServer.send_msg(node_id, services, "AddService");
    }

    public static GostDto UpdateService(Long node_id, String name, Integer in_port, Integer limiter,
                                        String remoteAddr, String targetStrategy,
                                        List<String> chainGroupNames, String groupStrategy,
                                        Integer maxFails, String failTimeout, String interfaceName) {
        JSONArray services = new JSONArray();
        String[] protocols = {"tcp", "udp"};
        for (String protocol : protocols) {
            JSONObject service = createServiceConfig(name, in_port, limiter, remoteAddr, protocol,
                    targetStrategy, chainGroupNames, groupStrategy, maxFails, failTimeout, interfaceName);
            services.add(service);
        }
        return WebSocketServer.send_msg(node_id, services, "UpdateService");
    }

    public static GostDto DeleteService(Long node_id, String name) {
        JSONObject data = new JSONObject();
        JSONArray services = new JSONArray();
        services.add(name + "_tcp");
        services.add(name + "_udp");
        data.put("services", services);
        return WebSocketServer.send_msg(node_id, data, "DeleteService");
    }

    public static GostDto PauseService(Long node_id, String name) {
        JSONObject data = new JSONObject();
        JSONArray services = new JSONArray();
        services.add(name + "_tcp");
        services.add(name + "_udp");
        data.put("services", services);
        return WebSocketServer.send_msg(node_id, data, "PauseService");
    }

    public static GostDto ResumeService(Long node_id, String name) {
        JSONObject data = new JSONObject();
        JSONArray services = new JSONArray();
        services.add(name + "_tcp");
        services.add(name + "_udp");
        data.put("services", services);
        return WebSocketServer.send_msg(node_id, data, "ResumeService");
    }

    // ==================== 线路中继服务(纯relay, connect模式) ====================

    public static GostDto AddRelayService(Long node_id, String relayName, String addr, String protocol) {
        JSONArray services = new JSONArray();
        services.add(createRelayService(relayName, addr, protocol));
        return WebSocketServer.send_msg(node_id, services, "AddService");
    }

    public static GostDto UpdateRelayService(Long node_id, String relayName, String addr, String protocol) {
        JSONArray services = new JSONArray();
        services.add(createRelayService(relayName, addr, protocol));
        return WebSocketServer.send_msg(node_id, services, "UpdateService");
    }

    public static GostDto DeleteRelayService(Long node_id, String relayName) {
        JSONObject data = new JSONObject();
        JSONArray services = new JSONArray();
        services.add(relayName);
        data.put("services", services);
        return WebSocketServer.send_msg(node_id, data, "DeleteService");
    }

    // ==================== 线路链(支持多跳) ====================

    /**
     * 创建线路链
     *
     * @param hopAddrs    按顺序的中继地址列表 host:port (最后一个为出口节点中继)
     * @param hopProtocol 中继传输协议 tcp/tls
     * @param probeAddrs  链路各端点探测地址(用于延迟策略与展示)
     */
    public static JSONObject buildChainJson(String chainName, List<String> hopAddrs,
                                            String hopProtocol, List<String> probeAddrs) {
        JSONObject data = new JSONObject();
        data.put("name", chainName);

        if (probeAddrs != null && !probeAddrs.isEmpty()) {
            JSONObject metadata = new JSONObject();
            metadata.put("probes", probeAddrs);
            data.put("metadata", metadata);
        }

        JSONArray hops = new JSONArray();
        int idx = 1;
        for (String addr : hopAddrs) {
            JSONObject dialer = new JSONObject();
            dialer.put("type", hopProtocol);

            JSONObject connector = new JSONObject();
            connector.put("type", "relay");

            JSONObject node = new JSONObject();
            node.put("name", "node-" + chainName + "-" + idx);
            node.put("addr", addr);
            node.put("connector", connector);
            node.put("dialer", dialer);

            JSONArray nodes = new JSONArray();
            nodes.add(node);

            JSONObject hop = new JSONObject();
            hop.put("name", "hop-" + chainName + "-" + idx);
            hop.put("nodes", nodes);

            hops.add(hop);
            idx++;
        }
        data.put("hops", hops);
        return data;
    }

    public static GostDto AddChains(Long node_id, JSONObject chainData) {
        return WebSocketServer.send_msg(node_id, chainData, "AddChains");
    }

    public static GostDto UpdateChains(Long node_id, JSONObject chainData) {
        JSONObject req = new JSONObject();
        req.put("chain", chainData.getString("name"));
        req.put("data", chainData);
        return WebSocketServer.send_msg(node_id, req, "UpdateChains");
    }

    public static GostDto DeleteChains(Long node_id, String chainName) {
        JSONObject data = new JSONObject();
        data.put("chain", chainName);
        return WebSocketServer.send_msg(node_id, data, "DeleteChains");
    }

    // ==================== 延迟探测 ====================

    public static GostDto UpdateProbes(Long node_id, List<JSONObject> probes) {
        JSONObject data = new JSONObject();
        data.put("probes", probes);
        return WebSocketServer.send_msg(node_id, data, "UpdateProbes");
    }

    public static GostDto Ping(Long node_id) {
        return WebSocketServer.send_msg(node_id, new JSONObject(), "Ping");
    }

    // ==================== WireGuard 组网 ====================

    /** 只准备节点密钥，不修改正在运行的 WireGuard 接口。 */
    public static GostDto WgPrepare(Long node_id, String name) {
        JSONObject req = new JSONObject();
        req.put("name", name);
        return WebSocketServer.send_msg(node_id, req, "WgPrepare");
    }

    public static GostDto WgApply(Long node_id, JSONObject req) {
        return WebSocketServer.send_msg(node_id, req, "WgApply");
    }

    /** 查询节点侧真实接口、peer、握手和流量状态。 */
    public static GostDto WgStatus(Long node_id, String name) {
        JSONObject req = new JSONObject();
        req.put("name", name);
        return WebSocketServer.send_msg(node_id, req, "WgStatus");
    }

    public static GostDto WgRemove(Long node_id, String name) {
        JSONObject req = new JSONObject();
        req.put("name", name);
        return WebSocketServer.send_msg(node_id, req, "WgRemove");
    }

    /** 组网内ICMP延迟探测 */
    public static GostDto PingIps(Long node_id, List<String> ips) {
        JSONObject data = new JSONObject();
        data.put("ips", ips);
        return WebSocketServer.send_msg(node_id, data, "PingIps");
    }

    /** 节点在线自更新 */
    public static GostDto UpdateAgent(Long node_id) {
        return WebSocketServer.send_msg(node_id, new JSONObject(), "UpdateAgent");
    }

    // ==================== 配置构造 ====================

    private static JSONObject createLimiterData(Long name, String speed) {
        JSONObject data = new JSONObject();
        data.put("name", name.toString());
        JSONArray limits = new JSONArray();
        limits.add("$ " + speed + "MB " + speed + "MB");
        data.put("limits", limits);
        return data;
    }

    private static JSONObject createRelayService(String name, String addr, String protocol) {
        JSONObject service = new JSONObject();
        service.put("name", name);
        service.put("addr", addr);
        JSONObject handler = new JSONObject();
        handler.put("type", "relay");
        service.put("handler", handler);
        JSONObject listener = new JSONObject();
        listener.put("type", protocol);
        service.put("listener", listener);
        return service;
    }

    private static JSONObject createServiceConfig(String name, Integer in_port, Integer limiter,
                                                  String remoteAddr, String protocol, String targetStrategy,
                                                  List<String> chainGroupNames, String groupStrategy,
                                                  Integer maxFails, String failTimeout, String interfaceName) {
        JSONObject service = new JSONObject();
        service.put("name", name + "_" + protocol);
        service.put("addr", "0.0.0.0:" + in_port);

        if (StringUtils.isNotBlank(interfaceName)) {
            JSONObject metadata = new JSONObject();
            metadata.put("interface", interfaceName);
            service.put("metadata", metadata);
        }

        if (limiter != null) {
            service.put("limiter", limiter.toString());
        }

        JSONObject handler = new JSONObject();
        handler.put("type", protocol);

        // 负载均衡: 多链路链组
        if (chainGroupNames != null && !chainGroupNames.isEmpty()) {
            JSONObject chainGroup = new JSONObject();
            chainGroup.put("chains", chainGroupNames);
            JSONObject selector = new JSONObject();
            selector.put("strategy", defaultIfBlank(groupStrategy, "round"));
            selector.put("maxFails", maxFails != null ? maxFails : 1);
            selector.put("failTimeout", StringUtils.isNotBlank(failTimeout) ? failTimeout : "600s");
            chainGroup.put("selector", selector);
            handler.put("chainGroup", chainGroup);
        }
        service.put("handler", handler);

        JSONObject listener = new JSONObject();
        listener.put("type", protocol);
        if (Objects.equals(protocol, "udp")) {
            JSONObject metadata = new JSONObject();
            metadata.put("keepAlive", true);
            listener.put("metadata", metadata);
        }
        service.put("listener", listener);

        // 目标转发
        if (StringUtils.isNotBlank(remoteAddr)) {
            service.put("forwarder", createForwarder(remoteAddr, defaultIfBlank(targetStrategy, "fifo")));
        }
        return service;
    }

    private static JSONObject createForwarder(String remoteAddr, String strategy) {
        JSONObject forwarder = new JSONObject();
        JSONArray nodes = new JSONArray();

        String[] split = remoteAddr.split(",");
        int num = 1;
        for (String addr : split) {
            JSONObject node = new JSONObject();
            node.put("name", "node_" + num);
            node.put("addr", addr);
            node.put("metadata", new JSONObject() {{
                put("probe", addr);
            }});
            nodes.add(node);
            num++;
        }

        forwarder.put("nodes", nodes);

        JSONObject selector = new JSONObject();
        selector.put("strategy", strategy);
        selector.put("maxFails", 1);
        selector.put("failTimeout", "600s");
        forwarder.put("selector", selector);
        return forwarder;
    }

    private static String defaultIfBlank(String value, String def) {
        return StringUtils.isBlank(value) ? def : value;
    }

}

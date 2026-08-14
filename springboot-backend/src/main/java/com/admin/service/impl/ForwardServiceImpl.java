package com.admin.service.impl;

import com.admin.common.dto.ForwardDto;
import com.admin.common.dto.ForwardUpdateDto;
import com.admin.common.dto.ForwardWithGroupDto;
import com.admin.common.dto.GostDto;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.LatencyCache;
import com.admin.common.utils.WebSocketServer;
import com.admin.entity.*;
import com.admin.mapper.ForwardMapper;
import com.admin.mapper.LinkMapper;
import com.admin.service.*;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.*;

/**
 * <p>
 * 端口转发服务实现类
 *
 * 模型: 转发 -> 负载均衡组 -> 线路(入口->...->出口)
 * 入口节点部署入口服务(chainGroup+forwarder), 出口/中间节点部署中继服务
 * </p>
 */
@Slf4j
@Service
public class ForwardServiceImpl extends ServiceImpl<ForwardMapper, Forward> implements ForwardService {

    private static final String GOST_SUCCESS_MSG = "OK";
    private static final String GOST_NOT_FOUND_MSG = "not found";

    private static final int FORWARD_STATUS_ACTIVE = 1;
    private static final int FORWARD_STATUS_PAUSED = 0;
    private static final int FORWARD_STATUS_ERROR = -1;

    private static final String TARGET_STRATEGIES = "round,random,fifo,hash,latency";

    @Resource
    @Lazy
    private LbGroupService lbGroupService;

    @Resource
    @Lazy
    private LinkService linkService;

    @Resource
    private NodeService nodeService;

    @Resource
    private LinkMapper linkMapper;

    @Override
    public R createForward(ForwardDto forwardDto) {
        // 1. 校验组与线路
        LbGroup group = validateGroup(forwardDto.getGroupId());
        if (group == null) {
            return R.err("负载均衡组不存在");
        }

        Integer entryNodeId = lbGroupService.getGroupEntryNode(forwardDto.getGroupId());
        Node entryNode = entryNodeId == null ? null : nodeService.getById(entryNodeId);
        if (entryNode == null) {
            return R.err("组内线路不存在或入口节点无效");
        }
        if (entryNode.getStatus() == null || entryNode.getStatus() != 1) {
            return R.err("入口节点不在线");
        }

        // 2. 校验目标策略
        String targetStrategy = forwardDto.getTargetStrategy();
        if (targetStrategy != null && !TARGET_STRATEGIES.contains(targetStrategy)) {
            return R.err("无效的目标策略: " + targetStrategy);
        }

        // 3. 分配端口
        Integer inPort = allocateInPort(entryNode, forwardDto.getInPort());
        if (inPort == null) {
            return R.err(forwardDto.getInPort() != null ? "端口已被占用或不在允许范围内" : "入口端口已满");
        }

        // 4. 保存
        Forward forward = new Forward();
        BeanUtils.copyProperties(forwardDto, forward);
        forward.setInPort(inPort);
        forward.setStatus(FORWARD_STATUS_ACTIVE);
        forward.setInFlow(0L);
        forward.setOutFlow(0L);
        long now = System.currentTimeMillis();
        forward.setCreatedTime(now);
        forward.setUpdatedTime(now);
        if (!this.save(forward)) {
            return R.err("端口转发创建失败");
        }

        // 5. 下发配置
        R deployResult = deployForward(forward);
        if (deployResult.getCode() != 0) {
            this.removeById(forward.getId());
            return deployResult;
        }

        pushProbes(forward);
        return R.ok();
    }

    @Override
    public R getAllForwards() {
        List<ForwardWithGroupDto> forwards = baseMapper.selectAllForwardsWithGroup();
        for (ForwardWithGroupDto dto : forwards) {
            dto.setTargetLatencies(new ArrayList<>());
            // 各线路出口节点到目标的延迟
            List<GroupLink> groupLinks = lbGroupService.getGroupLinks(dto.getGroupId() == null ? 0L : dto.getGroupId());
            for (GroupLink gl : groupLinks) {
                Link link = linkMapper.selectById(gl.getLinkId());
                if (link == null) continue;
                String[] targets = dto.getRemoteAddr() == null ? new String[0] : dto.getRemoteAddr().split(",");
                for (int i = 0; i < targets.length; i++) {
                    LatencyCache.ProbeEntry probe = LatencyCache.getProbe(
                            link.getExitNodeId().longValue(),
                            "fwd:" + dto.getId() + ":" + link.getId() + ":" + i);
                    if (probe != null) {
                        Map<String, Object> item = new HashMap<>();
                        item.put("key", probe.getKey());
                        item.put("addr", targets[i].trim());
                        item.put("ms", probe.getMs());
                        item.put("up", probe.isUp());
                        item.put("exitNodeId", link.getExitNodeId());
                        item.put("linkId", link.getId());
                        dto.getTargetLatencies().add(item);
                    }
                }
            }
        }
        return R.ok(forwards);
    }

    @Override
    public R updateForward(ForwardUpdateDto forwardUpdateDto) {
        Forward existForward = this.getById(forwardUpdateDto.getId());
        if (existForward == null) {
            return R.err("转发不存在");
        }

        Integer newGroupId = forwardUpdateDto.getGroupId() != null ? forwardUpdateDto.getGroupId() : existForward.getGroupId();
        boolean groupChanged = !existForward.getGroupId().equals(newGroupId);

        LbGroup group = validateGroup(newGroupId);
        if (group == null) {
            return R.err("负载均衡组不存在");
        }

        if (forwardUpdateDto.getTargetStrategy() != null && !TARGET_STRATEGIES.contains(forwardUpdateDto.getTargetStrategy())) {
            return R.err("无效的目标策略: " + forwardUpdateDto.getTargetStrategy());
        }

        Integer oldEntryNodeId = existForward.getGroupId() == null ? null
                : lbGroupService.getGroupEntryNode(existForward.getGroupId().longValue());
        Integer newEntryNodeId = lbGroupService.getGroupEntryNode(newGroupId.longValue());

        Node oldEntry = oldEntryNodeId == null ? null : nodeService.getById(oldEntryNodeId);
        Node newEntry = newEntryNodeId == null ? null : nodeService.getById(newEntryNodeId);

        // 更新实体
        Forward updated = new Forward();
        BeanUtils.copyProperties(forwardUpdateDto, updated);
        updated.setId(forwardUpdateDto.getId());
        updated.setGroupId(newGroupId);
        updated.setInPort(existForward.getInPort());
        updated.setInFlow(existForward.getInFlow());
        updated.setOutFlow(existForward.getOutFlow());
        updated.setCreatedTime(existForward.getCreatedTime());
        updated.setStatus(existForward.getStatus());
        updated.setUpdatedTime(System.currentTimeMillis());

        boolean portChanged = false;
        if (forwardUpdateDto.getInPort() != null && !forwardUpdateDto.getInPort().equals(existForward.getInPort())) {
            if (newEntry == null) {
                return R.err("入口节点无效");
            }
            Integer newPort = allocateInPort(newEntry, forwardUpdateDto.getInPort(), existForward.getId());
            if (newPort == null) {
                return R.err("端口已被占用或不在允许范围内");
            }
            updated.setInPort(newPort);
            portChanged = true;
        }

        if (!this.updateById(updated)) {
            return R.err("端口转发更新失败");
        }

        // 组变化时: 删除旧入口服务
        if (groupChanged && oldEntry != null) {
            try {
                GostUtil.DeleteService(oldEntry.getId(), buildServiceName(existForward.getId()));
            } catch (Exception e) {
                log.warn("删除旧入口服务失败: {}", e.getMessage());
            }
        }

        R deployResult = deployForward(updated);
        if (deployResult.getCode() != 0) {
            updateForwardStatusToError(updated);
            return deployResult;
        }
        pushProbes(updated);
        return R.ok();
    }

    @Override
    public R deleteForward(Long id) {
        Forward forward = this.getById(id);
        if (forward == null) {
            return R.err("端口转发不存在");
        }

        LbGroup group = forward.getGroupId() == null ? null : lbGroupService.getById(forward.getGroupId());
        Integer entryNodeId = forward.getGroupId() == null ? null : lbGroupService.getGroupEntryNode(forward.getGroupId().longValue());
        Node entry = entryNodeId == null ? null : nodeService.getById(entryNodeId);

        if (entry != null) {
            GostDto result = GostUtil.DeleteService(entry.getId(), buildServiceName(id));
            if (!isGostOperationSuccess(result)) {
                return R.err(result.getMsg());
            }
        }

        boolean result = this.removeById(id);
        return result ? R.ok("端口转发删除成功") : R.err("端口转发删除失败");
    }

    @Override
    public R forceDeleteForward(Long id) {
        Forward forward = this.getById(id);
        if (forward == null) {
            return R.err("端口转发不存在");
        }
        boolean result = this.removeById(id);
        return result ? R.ok("端口转发强制删除成功") : R.err("端口转发强制删除失败");
    }

    @Override
    public R pauseForward(Long id) {
        return changeForwardStatus(id, FORWARD_STATUS_PAUSED, "暂停");
    }

    @Override
    public R resumeForward(Long id) {
        return changeForwardStatus(id, FORWARD_STATUS_ACTIVE, "恢复");
    }

    @Override
    public R diagnoseForward(Long id) {
        Forward forward = this.getById(id);
        if (forward == null) {
            return R.err("转发不存在");
        }

        Integer entryNodeId = lbGroupService.getGroupEntryNode(forward.getGroupId() == null ? 0L : forward.getGroupId());
        Node entry = entryNodeId == null ? null : nodeService.getById(entryNodeId);
        if (entry == null) {
            return R.err("入口节点不存在");
        }

        List<Map<String, Object>> results = new ArrayList<>();
        String[] remoteAddresses = forward.getRemoteAddr() == null ? new String[0] : forward.getRemoteAddr().split(",");

        // 入口节点到组内各线路出口的延迟(经组网/公网)
        List<GroupLink> groupLinks = lbGroupService.getGroupLinks(forward.getGroupId().longValue());
        for (GroupLink gl : groupLinks) {
            Link link = linkMapper.selectById(gl.getLinkId());
            if (link == null) continue;
            Node exitNode = nodeService.getById(link.getExitNodeId());
            if (exitNode == null) continue;
            Integer probePort = getLinkExitProbePort(link, exitNode);
            if (probePort == null) {
                // 直连线路(入口=出口), 无中继, 跳过链路段
                continue;
            }
            Map<String, Object> item = new HashMap<>();
            item.put("nodeName", entry.getName() + " -> " + exitNode.getName());
            item.put("description", "入口->出口(" + link.getName() + ")");
            performDiagnosis(entry, exitNode.getServerIp(), probePort, item, results);
        }

        // 各线路出口节点到目标
        for (GroupLink gl : groupLinks) {
            Link link = linkMapper.selectById(gl.getLinkId());
            if (link == null) continue;
            Node exitNode = nodeService.getById(link.getExitNodeId());
            if (exitNode == null) continue;
            for (String remoteAddress : remoteAddresses) {
                String targetIp = extractIpFromAddress(remoteAddress);
                int targetPort = extractPortFromAddress(remoteAddress);
                if (targetIp == null || targetPort == -1) continue;
                Map<String, Object> item = new HashMap<>();
                item.put("nodeName", exitNode.getName());
                item.put("description", "出口->目标(" + link.getName() + ")");
                performDiagnosis(exitNode, targetIp, targetPort, item, results);
            }
        }

        Map<String, Object> diagnosisReport = new HashMap<>();
        diagnosisReport.put("forwardId", id);
        diagnosisReport.put("forwardName", forward.getName());
        diagnosisReport.put("results", results);
        diagnosisReport.put("timestamp", System.currentTimeMillis());
        return R.ok(diagnosisReport);
    }

    @Override
    public R updateForwardOrder(Map<String, Object> params) {
        try {
            if (!params.containsKey("forwards")) {
                return R.err("缺少forwards参数");
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> forwardsList = (List<Map<String, Object>>) params.get("forwards");
            if (forwardsList == null || forwardsList.isEmpty()) {
                return R.err("forwards参数不能为空");
            }
            List<Forward> forwardsToUpdate = new ArrayList<>();
            for (Map<String, Object> forwardData : forwardsList) {
                Long id = Long.valueOf(forwardData.get("id").toString());
                Integer inx = Integer.valueOf(forwardData.get("inx").toString());
                Forward forward = new Forward();
                forward.setId(id);
                forward.setInx(inx);
                forwardsToUpdate.add(forward);
            }
            boolean success = this.updateBatchById(forwardsToUpdate);
            return success ? R.ok("排序更新成功") : R.err("排序更新失败");
        } catch (Exception e) {
            log.error("更新转发排序失败", e);
            return R.err("更新排序时发生错误: " + e.getMessage());
        }
    }

    @Override
    public R redeployGroup(Long groupId) {
        List<Forward> forwards = this.list(new QueryWrapper<Forward>().eq("group_id", groupId));
        for (Forward forward : forwards) {
            R result = deployForward(forward);
            if (result.getCode() != 0) {
                log.warn("组重下发失败 forward={}: {}", forward.getId(), result.getMsg());
            }
            pushProbes(forward);
        }
        return R.ok();
    }

    /**
     * 下发转发完整配置:
     *  1. 确保组内各线路链已下发(入口节点)
     *  2. 下发入口服务(tcp+udp, chainGroup + forwarder)
     */
    @Override
    public R deployForward(Forward forward) {
        LbGroup group = validateGroup(forward.getGroupId());
        if (group == null) {
            return R.err("负载均衡组不存在");
        }

        Integer entryNodeId = lbGroupService.getGroupEntryNode(forward.getGroupId().longValue());
        Node entryNode = entryNodeId == null ? null : nodeService.getById(entryNodeId);
        if (entryNode == null) {
            return R.err("组内线路不存在或入口节点无效");
        }
        if (entryNode.getStatus() == null || entryNode.getStatus() != 1) {
            return R.err("入口节点不在线");
        }

        // 1. 下发所有线路链
        List<GroupLink> groupLinks = lbGroupService.getGroupLinks(forward.getGroupId().longValue());
        List<String> chainNames = new ArrayList<>();
        for (GroupLink gl : groupLinks) {
            Link link = linkMapper.selectById(gl.getLinkId());
            if (link == null) continue;
            String chainName = LinkServiceImpl.buildChainName(link.getId());
            chainNames.add(chainName);
            JSONObject chainConfig = linkService.buildChainConfig(link);
            GostDto chainResult = GostUtil.UpdateChains(entryNode.getId(), chainConfig);
            if (chainResult.getMsg().contains(GOST_NOT_FOUND_MSG)) {
                chainResult = GostUtil.AddChains(entryNode.getId(), chainConfig);
            }
            if (!isGostOperationSuccess(chainResult)) {
                return R.err("线路链下发失败: " + chainResult.getMsg());
            }
        }

        if (chainNames.isEmpty()) {
            return R.err("组内没有可用线路");
        }

        // 2. 下发入口服务
        Integer limiter = forward.getSpeedId();
        String serviceName = buildServiceName(forward.getId());
        GostDto result = GostUtil.UpdateService(entryNode.getId(), serviceName, forward.getInPort(), limiter,
                forward.getRemoteAddr(), forward.getTargetStrategy(),
                chainNames, group.getStrategy(), group.getMaxFails(), group.getFailTimeout(),
                forward.getInterfaceName());
        if (result.getMsg().contains(GOST_NOT_FOUND_MSG)) {
            result = GostUtil.AddService(entryNode.getId(), serviceName, forward.getInPort(), limiter,
                    forward.getRemoteAddr(), forward.getTargetStrategy(),
                    chainNames, group.getStrategy(), group.getMaxFails(), group.getFailTimeout(),
                    forward.getInterfaceName());
        }
        if (!isGostOperationSuccess(result)) {
            return R.err("入口服务下发失败: " + result.getMsg());
        }
        return R.ok();
    }

    /**
     * 更新探测配置:
     *  - 入口节点: 探测组内各线路的中继端点(链路延迟)
     *  - 各线路出口节点: 探测目标地址(出口到目标延迟)
     */
    @Override
    public void pushProbes(Forward forward) {
        if (forward.getGroupId() == null) return;
        LbGroup group = lbGroupService.getById(forward.getGroupId());
        if (group == null) return;

        Map<Long, List<JSONObject>> probesByNode = new HashMap<>();

        List<GroupLink> groupLinks = lbGroupService.getGroupLinks(forward.getGroupId().longValue());
        for (GroupLink gl : groupLinks) {
            Link link = linkMapper.selectById(gl.getLinkId());
            if (link == null) continue;

            // 入口节点探测链路各中继端点
            List<LinkRelay> relays = linkService.getLinkRelays(link.getId());
            List<JSONObject> entryProbes = probesByNode.computeIfAbsent(link.getEntryNodeId().longValue(), k -> new ArrayList<>());
            for (LinkRelay relay : relays) {
                String addr = relay.getAddr() + ":" + relay.getPort();
                JSONObject probe = new JSONObject();
                probe.put("key", "link:" + link.getId() + ":" + relay.getNodeId());
                probe.put("addr", addr);
                entryProbes.add(probe);
            }

            // 出口节点探测目标
            Node exitNode = nodeService.getById(link.getExitNodeId());
            if (exitNode == null) continue;
            List<JSONObject> exitProbes = probesByNode.computeIfAbsent(exitNode.getId(), k -> new ArrayList<>());
            String[] targets = forward.getRemoteAddr() == null ? new String[0] : forward.getRemoteAddr().split(",");
            for (int i = 0; i < targets.length; i++) {
                String target = targets[i].trim();
                if (target.isEmpty()) continue;
                JSONObject probe = new JSONObject();
                probe.put("key", "fwd:" + forward.getId() + ":" + link.getId() + ":" + i);
                probe.put("addr", target);
                exitProbes.add(probe);
            }
        }

        // 下发到各节点(合并同节点已有探测)
        for (Map.Entry<Long, List<JSONObject>> entry : probesByNode.entrySet()) {
            Node node = nodeService.getById(entry.getKey());
            if (node == null || node.getStatus() == null || node.getStatus() != 1) continue;
            List<JSONObject> existing = LatencyCache.getNodeProbes(entry.getKey());
            Set<String> keys = new HashSet<>();
            for (JSONObject probe : entry.getValue()) {
                keys.add(probe.getString("key"));
            }
            for (LatencyCache.ProbeEntry pe : existing) {
                if (!pe.getKey().startsWith("link:") && !pe.getKey().startsWith("fwd:")) continue;
                if (!keys.contains(pe.getKey())) {
                    JSONObject probe = new JSONObject();
                    probe.put("key", pe.getKey());
                    probe.put("addr", pe.getAddr());
                    entry.getValue().add(probe);
                }
            }
            GostUtil.UpdateProbes(node.getId(), entry.getValue());
        }
    }

    // ==================== 内部方法 ====================

    private R changeForwardStatus(Long id, int targetStatus, String operation) {
        Forward forward = this.getById(id);
        if (forward == null) {
            return R.err("转发不存在");
        }

        // 恢复时先重新下发, 确保配置与当前组/线路一致
        if (targetStatus == FORWARD_STATUS_ACTIVE) {
            R deployResult = deployForward(forward);
            if (deployResult.getCode() != 0) {
                return deployResult;
            }
        }

        Integer entryNodeId = lbGroupService.getGroupEntryNode(forward.getGroupId().longValue());
        Node entry = entryNodeId == null ? null : nodeService.getById(entryNodeId);
        if (entry == null) {
            return R.err("入口节点不存在");
        }

        GostDto gostResult;
        if (targetStatus == FORWARD_STATUS_PAUSED) {
            gostResult = GostUtil.PauseService(entry.getId(), buildServiceName(id));
        } else {
            gostResult = GostUtil.ResumeService(entry.getId(), buildServiceName(id));
        }

        if (!isGostOperationSuccess(gostResult)) {
            return R.err(operation + "服务失败：" + gostResult.getMsg());
        }

        forward.setStatus(targetStatus);
        forward.setUpdatedTime(System.currentTimeMillis());
        boolean result = this.updateById(forward);
        return result ? R.ok("服务已" + operation) : R.err("更新状态失败");
    }

    private LbGroup validateGroup(Integer groupId) {
        if (groupId == null) return null;
        LbGroup group = lbGroupService.getById(groupId);
        if (group == null || group.getStatus() == null || group.getStatus() != 1) {
            return null;
        }
        return group;
    }

    private String buildServiceName(Long forwardId) {
        return "F" + forwardId;
    }

    private Integer allocateInPort(Node node, Integer specifiedPort) {
        return allocateInPort(node, specifiedPort, null);
    }

    private Integer allocateInPort(Node node, Integer specifiedPort, Long excludeForwardId) {
        // 该节点作为入口时被占用的端口
        Set<Integer> nodePorts = new HashSet<>();
        for (Forward f : this.list(null)) {
            if (excludeForwardId != null && Objects.equals(f.getId(), excludeForwardId)) continue;
            Integer entryNodeId = lbGroupService.getGroupEntryNode(f.getGroupId().longValue());
            if (entryNodeId != null && Objects.equals(entryNodeId.longValue(), node.getId().longValue())) {
                nodePorts.add(f.getInPort());
            }
        }

        if (specifiedPort != null) {
            if (nodePorts.contains(specifiedPort)) {
                return null;
            }
            if (specifiedPort < node.getPortSta() || specifiedPort > node.getPortEnd()) {
                return null;
            }
            return specifiedPort;
        }

        for (int port = node.getPortSta(); port <= node.getPortEnd(); port++) {
            if (!nodePorts.contains(port)) {
                return port;
            }
        }
        return null;
    }

    private void performDiagnosis(Node node, String targetIp, int port, Map<String, Object> item, List<Map<String, Object>> results) {
        JSONObject tcpPingData = new JSONObject();
        tcpPingData.put("ip", targetIp);
        tcpPingData.put("port", port);
        tcpPingData.put("count", 2);
        tcpPingData.put("timeout", 3000);

        GostDto gostResult = WebSocketServer.send_msg(node.getId(), tcpPingData, "TcpPing");
        item.put("success", false);
        item.put("message", "节点无响应");
        item.put("averageTime", -1.0);
        item.put("packetLoss", 100.0);
        try {
            if (gostResult != null && "OK".equals(gostResult.getMsg()) && gostResult.getData() != null) {
                JSONObject resp = (JSONObject) JSONObject.toJSON(gostResult.getData());
                item.put("success", resp.getBooleanValue("success"));
                if (resp.getBooleanValue("success")) {
                    item.put("message", "连接成功");
                    item.put("averageTime", resp.getDoubleValue("averageTime"));
                    item.put("packetLoss", resp.getDoubleValue("packetLoss"));
                } else {
                    item.put("message", resp.getString("errorMessage"));
                }
            }
        } catch (Exception e) {
            log.warn("诊断解析失败: {}", e.getMessage());
        }
        results.add(item);
    }

    private Integer getLinkExitProbePort(Link link, Node exitNode) {
        List<LinkRelay> relays = linkService.getLinkRelays(link.getId());
        for (LinkRelay relay : relays) {
            if (Objects.equals(relay.getNodeId(), exitNode.getId().intValue())) {
                return relay.getPort();
            }
        }
        return null;
    }

    private String extractIpFromAddress(String address) {
        if (address == null || address.trim().isEmpty()) {
            return null;
        }
        address = address.trim();
        if (address.startsWith("[")) {
            int closeBracket = address.indexOf(']');
            if (closeBracket > 1) {
                return address.substring(1, closeBracket);
            }
        }
        int lastColon = address.lastIndexOf(':');
        if (lastColon > 0) {
            return address.substring(0, lastColon);
        }
        return address;
    }

    private int extractPortFromAddress(String address) {
        if (address == null || address.trim().isEmpty()) {
            return -1;
        }
        address = address.trim();
        if (address.startsWith("[")) {
            int closeBracket = address.indexOf(']');
            if (closeBracket > 1 && closeBracket + 1 < address.length() && address.charAt(closeBracket + 1) == ':') {
                String portStr = address.substring(closeBracket + 2);
                try {
                    return Integer.parseInt(portStr);
                } catch (NumberFormatException e) {
                    return -1;
                }
            }
        }
        int lastColon = address.lastIndexOf(':');
        if (lastColon > 0 && lastColon + 1 < address.length()) {
            String portStr = address.substring(lastColon + 1);
            try {
                return Integer.parseInt(portStr);
            } catch (NumberFormatException e) {
                return -1;
            }
        }
        return -1;
    }

    private void updateForwardStatusToError(Forward forward) {
        forward.setStatus(FORWARD_STATUS_ERROR);
        this.updateById(forward);
    }

    private boolean isGostOperationSuccess(GostDto gostResult) {
        return gostResult != null && Objects.equals(gostResult.getMsg(), GOST_SUCCESS_MSG);
    }

}

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
 * 绔彛杞彂鏈嶅姟瀹炵幇绫? *
 * 妯″瀷: 杞彂 -> 璐熻浇鍧囪　缁?-> 绾胯矾(鍏ュ彛->...->鍑哄彛)
 * 鍏ュ彛鑺傜偣閮ㄧ讲鍏ュ彛鏈嶅姟(chainGroup+forwarder), 鍑哄彛/涓棿鑺傜偣閮ㄧ讲涓户鏈嶅姟
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
        // 1. 鏍￠獙缁勪笌绾胯矾
        LbGroup group = validateGroup(forwardDto.getGroupId());
        if (group == null) {
            return R.err("璐熻浇鍧囪　缁勪笉瀛樺湪");
        }

        Integer entryNodeId = lbGroupService.getGroupEntryNode(forwardDto.getGroupId());
        Node entryNode = entryNodeId == null ? null : nodeService.getById(entryNodeId);
        if (entryNode == null) {
            return R.err("缁勫唴绾胯矾涓嶅瓨鍦ㄦ垨鍏ュ彛鑺傜偣鏃犳晥");
        }
        if (entryNode.getStatus() == null || entryNode.getStatus() != 1) {
            return R.err("鍏ュ彛鑺傜偣涓嶅湪绾?);
        }

        // 2. 鏍￠獙鐩爣绛栫暐
        String targetStrategy = forwardDto.getTargetStrategy();
        if (targetStrategy != null && !TARGET_STRATEGIES.contains(targetStrategy)) {
            return R.err("鏃犳晥鐨勭洰鏍囩瓥鐣? " + targetStrategy);
        }

        // 3. 鍒嗛厤绔彛
        Integer inPort = allocateInPort(entryNode, forwardDto.getInPort());
        if (inPort == null) {
            return R.err(forwardDto.getInPort() != null ? "绔彛宸茶鍗犵敤鎴栦笉鍦ㄥ厑璁歌寖鍥村唴" : "鍏ュ彛绔彛宸叉弧");
        }

        // 4. 淇濆瓨
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
            return R.err("绔彛杞彂鍒涘缓澶辫触");
        }

        // 5. 涓嬪彂閰嶇疆
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
            // 鍚勭嚎璺嚭鍙ｈ妭鐐瑰埌鐩爣鐨勫欢杩?            List<GroupLink> groupLinks = lbGroupService.getGroupLinks(dto.getGroupId() == null ? 0L : dto.getGroupId());
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
            return R.err("杞彂涓嶅瓨鍦?);
        }

        Integer newGroupId = forwardUpdateDto.getGroupId() != null ? forwardUpdateDto.getGroupId() : existForward.getGroupId();
        boolean groupChanged = !existForward.getGroupId().equals(newGroupId);

        LbGroup group = validateGroup(newGroupId);
        if (group == null) {
            return R.err("璐熻浇鍧囪　缁勪笉瀛樺湪");
        }

        if (forwardUpdateDto.getTargetStrategy() != null && !TARGET_STRATEGIES.contains(forwardUpdateDto.getTargetStrategy())) {
            return R.err("鏃犳晥鐨勭洰鏍囩瓥鐣? " + forwardUpdateDto.getTargetStrategy());
        }

        Integer oldEntryNodeId = existForward.getGroupId() == null ? null
                : lbGroupService.getGroupEntryNode(existForward.getGroupId());
        Integer newEntryNodeId = lbGroupService.getGroupEntryNode(newGroupId);

        Node oldEntry = oldEntryNodeId == null ? null : nodeService.getById(oldEntryNodeId);
        Node newEntry = newEntryNodeId == null ? null : nodeService.getById(newEntryNodeId);

        // 鏇存柊瀹炰綋
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
                return R.err("鍏ュ彛鑺傜偣鏃犳晥");
            }
            Integer newPort = allocateInPort(newEntry, forwardUpdateDto.getInPort(), existForward.getId());
            if (newPort == null) {
                return R.err("绔彛宸茶鍗犵敤鎴栦笉鍦ㄥ厑璁歌寖鍥村唴");
            }
            updated.setInPort(newPort);
            portChanged = true;
        }

        if (!this.updateById(updated)) {
            return R.err("绔彛杞彂鏇存柊澶辫触");
        }

        // 缁勫彉鍖栨椂: 鍒犻櫎鏃у叆鍙ｆ湇鍔?        if (groupChanged && oldEntry != null) {
            try {
                GostUtil.DeleteService(oldEntry.getId(), buildServiceName(existForward.getId()));
            } catch (Exception e) {
                log.warn("鍒犻櫎鏃у叆鍙ｆ湇鍔″け璐? {}", e.getMessage());
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
            return R.err("绔彛杞彂涓嶅瓨鍦?);
        }

        LbGroup group = forward.getGroupId() == null ? null : lbGroupService.getById(forward.getGroupId());
        Integer entryNodeId = forward.getGroupId() == null ? null : lbGroupService.getGroupEntryNode(forward.getGroupId());
        Node entry = entryNodeId == null ? null : nodeService.getById(entryNodeId);

        if (entry != null) {
            GostDto result = GostUtil.DeleteService(entry.getId(), buildServiceName(id));
            if (!isGostOperationSuccess(result)) {
                return R.err(result.getMsg());
            }
        }

        boolean result = this.removeById(id);
        return result ? R.ok("绔彛杞彂鍒犻櫎鎴愬姛") : R.err("绔彛杞彂鍒犻櫎澶辫触");
    }

    @Override
    public R forceDeleteForward(Long id) {
        Forward forward = this.getById(id);
        if (forward == null) {
            return R.err("绔彛杞彂涓嶅瓨鍦?);
        }
        boolean result = this.removeById(id);
        return result ? R.ok("绔彛杞彂寮哄埗鍒犻櫎鎴愬姛") : R.err("绔彛杞彂寮哄埗鍒犻櫎澶辫触");
    }

    @Override
    public R pauseForward(Long id) {
        return changeForwardStatus(id, FORWARD_STATUS_PAUSED, "鏆傚仠");
    }

    @Override
    public R resumeForward(Long id) {
        return changeForwardStatus(id, FORWARD_STATUS_ACTIVE, "鎭㈠");
    }

    @Override
    public R diagnoseForward(Long id) {
        Forward forward = this.getById(id);
        if (forward == null) {
            return R.err("杞彂涓嶅瓨鍦?);
        }

        Integer entryNodeId = lbGroupService.getGroupEntryNode(forward.getGroupId() == null ? null : forward.getGroupId());
        Node entry = entryNodeId == null ? null : nodeService.getById(entryNodeId);
        if (entry == null) {
            return R.err("鍏ュ彛鑺傜偣涓嶅瓨鍦?);
        }

        List<Map<String, Object>> results = new ArrayList<>();
        String[] remoteAddresses = forward.getRemoteAddr() == null ? new String[0] : forward.getRemoteAddr().split(",");

        // 鍏ュ彛鑺傜偣鍒扮粍鍐呭悇绾胯矾鍑哄彛鐨勫欢杩?缁忕粍缃?鍏綉)
        List<GroupLink> groupLinks = lbGroupService.getGroupLinks(forward.getGroupId().longValue());
        for (GroupLink gl : groupLinks) {
            Link link = linkMapper.selectById(gl.getLinkId());
            if (link == null) continue;
            Node exitNode = nodeService.getById(link.getExitNodeId());
            if (exitNode == null) continue;
            Integer probePort = getLinkExitProbePort(link, exitNode);
            if (probePort == null) {
                // 鐩磋繛绾胯矾(鍏ュ彛=鍑哄彛), 鏃犱腑缁? 璺宠繃閾捐矾娈?                continue;
            }
            Map<String, Object> item = new HashMap<>();
            item.put("nodeName", entry.getName() + " -> " + exitNode.getName());
            item.put("description", "鍏ュ彛->鍑哄彛(" + link.getName() + ")");
            performDiagnosis(entry, exitNode.getServerIp(), probePort, item, results);
        }

        // 鍚勭嚎璺嚭鍙ｈ妭鐐瑰埌鐩爣
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
                item.put("description", "鍑哄彛->鐩爣(" + link.getName() + ")");
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
                return R.err("缂哄皯forwards鍙傛暟");
            }
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> forwardsList = (List<Map<String, Object>>) params.get("forwards");
            if (forwardsList == null || forwardsList.isEmpty()) {
                return R.err("forwards鍙傛暟涓嶈兘涓虹┖");
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
            return success ? R.ok("鎺掑簭鏇存柊鎴愬姛") : R.err("鎺掑簭鏇存柊澶辫触");
        } catch (Exception e) {
            log.error("鏇存柊杞彂鎺掑簭澶辫触", e);
            return R.err("鏇存柊鎺掑簭鏃跺彂鐢熼敊璇? " + e.getMessage());
        }
    }

    @Override
    public R redeployGroup(Long groupId) {
        List<Forward> forwards = this.list(new QueryWrapper<Forward>().eq("group_id", groupId));
        for (Forward forward : forwards) {
            R result = deployForward(forward);
            if (result.getCode() != 0) {
                log.warn("缁勯噸涓嬪彂澶辫触 forward={}: {}", forward.getId(), result.getMsg());
            }
            pushProbes(forward);
        }
        return R.ok();
    }

    /**
     * 涓嬪彂杞彂瀹屾暣閰嶇疆:
     *  1. 纭繚缁勫唴鍚勭嚎璺摼宸蹭笅鍙?鍏ュ彛鑺傜偣)
     *  2. 涓嬪彂鍏ュ彛鏈嶅姟(tcp+udp, chainGroup + forwarder)
     */
    @Override
    public R deployForward(Forward forward) {
        LbGroup group = validateGroup(forward.getGroupId());
        if (group == null) {
            return R.err("璐熻浇鍧囪　缁勪笉瀛樺湪");
        }

        Integer entryNodeId = lbGroupService.getGroupEntryNode(forward.getGroupId());
        Node entryNode = entryNodeId == null ? null : nodeService.getById(entryNodeId);
        if (entryNode == null) {
            return R.err("缁勫唴绾胯矾涓嶅瓨鍦ㄦ垨鍏ュ彛鑺傜偣鏃犳晥");
        }
        if (entryNode.getStatus() == null || entryNode.getStatus() != 1) {
            return R.err("鍏ュ彛鑺傜偣涓嶅湪绾?);
        }

        // 1. 涓嬪彂鎵€鏈夌嚎璺摼
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
                return R.err("绾胯矾閾句笅鍙戝け璐? " + chainResult.getMsg());
            }
        }

        if (chainNames.isEmpty()) {
            return R.err("缁勫唴娌℃湁鍙敤绾胯矾");
        }

        // 2. 涓嬪彂鍏ュ彛鏈嶅姟
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
            return R.err("鍏ュ彛鏈嶅姟涓嬪彂澶辫触: " + result.getMsg());
        }
        return R.ok();
    }

    /**
     * 鏇存柊鎺㈡祴閰嶇疆:
     *  - 鍏ュ彛鑺傜偣: 鎺㈡祴缁勫唴鍚勭嚎璺殑涓户绔偣(閾捐矾寤惰繜)
     *  - 鍚勭嚎璺嚭鍙ｈ妭鐐? 鎺㈡祴鐩爣鍦板潃(鍑哄彛鍒扮洰鏍囧欢杩?
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

            // 鍏ュ彛鑺傜偣鎺㈡祴閾捐矾鍚勪腑缁х鐐?            List<LinkRelay> relays = linkService.getLinkRelays(link.getId());
            List<JSONObject> entryProbes = probesByNode.computeIfAbsent(link.getEntryNodeId().longValue(), k -> new ArrayList<>());
            for (LinkRelay relay : relays) {
                String addr = relay.getAddr() + ":" + relay.getPort();
                JSONObject probe = new JSONObject();
                probe.put("key", "link:" + link.getId() + ":" + relay.getNodeId());
                probe.put("addr", addr);
                entryProbes.add(probe);
            }

            // 鍑哄彛鑺傜偣鎺㈡祴鐩爣
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

        // 涓嬪彂鍒板悇鑺傜偣(鍚堝苟鍚岃妭鐐瑰凡鏈夋帰娴?
        for (Map.Entry<Long, List<JSONObject>> entry : probesByNode.entrySet()) {
            Node node = nodeService.getById(entry.getKey());
            if (node == null || node.getStatus() == null || node.getStatus() != 1) continue;
            List<LatencyCache.ProbeEntry> existing = LatencyCache.getNodeProbes(entry.getKey());
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

    // ==================== 鍐呴儴鏂规硶 ====================

    private R changeForwardStatus(Long id, int targetStatus, String operation) {
        Forward forward = this.getById(id);
        if (forward == null) {
            return R.err("杞彂涓嶅瓨鍦?);
        }

        // 鎭㈠鏃跺厛閲嶆柊涓嬪彂, 纭繚閰嶇疆涓庡綋鍓嶇粍/绾胯矾涓€鑷?        if (targetStatus == FORWARD_STATUS_ACTIVE) {
            R deployResult = deployForward(forward);
            if (deployResult.getCode() != 0) {
                return deployResult;
            }
        }

        Integer entryNodeId = lbGroupService.getGroupEntryNode(forward.getGroupId());
        Node entry = entryNodeId == null ? null : nodeService.getById(entryNodeId);
        if (entry == null) {
            return R.err("鍏ュ彛鑺傜偣涓嶅瓨鍦?);
        }

        GostDto gostResult;
        if (targetStatus == FORWARD_STATUS_PAUSED) {
            gostResult = GostUtil.PauseService(entry.getId(), buildServiceName(id));
        } else {
            gostResult = GostUtil.ResumeService(entry.getId(), buildServiceName(id));
        }

        if (!isGostOperationSuccess(gostResult)) {
            return R.err(operation + "鏈嶅姟澶辫触锛? + gostResult.getMsg());
        }

        forward.setStatus(targetStatus);
        forward.setUpdatedTime(System.currentTimeMillis());
        boolean result = this.updateById(forward);
        return result ? R.ok("鏈嶅姟宸? + operation) : R.err("鏇存柊鐘舵€佸け璐?);
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
        // 璇ヨ妭鐐逛綔涓哄叆鍙ｆ椂琚崰鐢ㄧ殑绔彛
        Set<Integer> nodePorts = new HashSet<>();
        for (Forward f : this.list(null)) {
            if (excludeForwardId != null && Objects.equals(f.getId(), excludeForwardId)) continue;
            Integer entryNodeId = lbGroupService.getGroupEntryNode(f.getGroupId());
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
        item.put("message", "鑺傜偣鏃犲搷搴?);
        item.put("averageTime", -1.0);
        item.put("packetLoss", 100.0);
        try {
            if (gostResult != null && "OK".equals(gostResult.getMsg()) && gostResult.getData() != null) {
                JSONObject resp = (JSONObject) JSONObject.toJSON(gostResult.getData());
                item.put("success", resp.getBooleanValue("success"));
                if (resp.getBooleanValue("success")) {
                    item.put("message", "杩炴帴鎴愬姛");
                    item.put("averageTime", resp.getDoubleValue("averageTime"));
                    item.put("packetLoss", resp.getDoubleValue("packetLoss"));
                } else {
                    item.put("message", resp.getString("errorMessage"));
                }
            }
        } catch (Exception e) {
            log.warn("璇婃柇瑙ｆ瀽澶辫触: {}", e.getMessage());
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

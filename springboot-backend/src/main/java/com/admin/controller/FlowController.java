package com.admin.controller;

import com.admin.common.aop.LogAnnotation;
import com.admin.common.dto.FlowDto;
import com.admin.common.dto.GostConfigDto;
import com.admin.common.lang.R;
import com.admin.common.task.CheckGostConfigAsync;
import com.admin.common.utils.AESCrypto;
import com.admin.entity.Forward;
import com.admin.entity.Node;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import org.springframework.web.bind.annotation.*;
import lombok.extern.slf4j.Slf4j;

import javax.annotation.Resource;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 节点上报控制器
 *
 * /relay/traffic 流量上报
 * /relay/state   配置快照上报(用于清理孤儿配置)
 */
@RestController
@RequestMapping("/relay")
@CrossOrigin
@Slf4j
public class FlowController extends BaseController {

    private static final String SUCCESS_RESPONSE = "ok";

    private static final ConcurrentHashMap<String, Object> FORWARD_LOCKS = new ConcurrentHashMap<>();
    private static final ConcurrentHashMap<String, AESCrypto> CRYPTO_CACHE = new ConcurrentHashMap<>();

    @Resource
    CheckGostConfigAsync checkGostConfigAsync;

    public static class EncryptedMessage {
        private boolean encrypted;
        private String data;
        private Long timestamp;

        public boolean isEncrypted() { return encrypted; }
        public void setEncrypted(boolean encrypted) { this.encrypted = encrypted; }
        public String getData() { return data; }
        public void setData(String data) { this.data = data; }
        public Long getTimestamp() { return timestamp; }
        public void setTimestamp(Long timestamp) { this.timestamp = timestamp; }
    }

    @PostMapping("/state")
    @LogAnnotation
    public String state(@RequestBody String rawData, String secret) {
        Node node = nodeService.getOne(new QueryWrapper<Node>().eq("secret", secret));
        if (node == null) return SUCCESS_RESPONSE;

        try {
            String decryptedData = decryptIfNeeded(rawData, secret);
            GostConfigDto gostConfigDto = JSON.parseObject(decryptedData, GostConfigDto.class);
            checkGostConfigAsync.cleanNodeConfigs(node.getId(), gostConfigDto);
        } catch (Exception e) {
            log.warn("处理节点配置上报失败 node={}: {}", node.getId(), e.getMessage());
        }
        return SUCCESS_RESPONSE;
    }

    @PostMapping("/traffic")
    @LogAnnotation
    public String uploadFlowData(@RequestBody String rawData, String secret) {
        if (!isValidNode(secret)) {
            return SUCCESS_RESPONSE;
        }

        try {
            String decryptedData = decryptIfNeeded(rawData, secret);
            FlowDto flowDataList = JSONObject.parseObject(decryptedData, FlowDto.class);
            if (flowDataList == null || flowDataList.getN() == null) {
                return SUCCESS_RESPONSE;
            }
            processFlowData(flowDataList);
        } catch (Exception e) {
            log.warn("处理流量上报失败: {}", e.getMessage());
        }
        return SUCCESS_RESPONSE;
    }

    private String decryptIfNeeded(String rawData, String secret) {
        if (rawData == null || rawData.trim().isEmpty()) {
            return rawData;
        }
        try {
            EncryptedMessage encryptedMessage = JSON.parseObject(rawData, EncryptedMessage.class);
            if (encryptedMessage.isEncrypted() && encryptedMessage.getData() != null) {
                AESCrypto crypto = getOrCreateCrypto(secret);
                if (crypto != null) {
                    return crypto.decryptString(encryptedMessage.getData());
                }
            }
        } catch (Exception e) {
            log.info("数据未加密或解密失败, 使用原始数据: {}", e.getMessage());
        }
        return rawData;
    }

    private AESCrypto getOrCreateCrypto(String secret) {
        return CRYPTO_CACHE.computeIfAbsent(secret, AESCrypto::create);
    }

    /**
     * 处理流量数据: 仅统计转发级流量
     * 服务名格式: F{forwardId}_tcp / F{forwardId}_udp
     */
    private void processFlowData(FlowDto flowDataList) {
        String serviceName = flowDataList.getN();
        // 仅统计转发入口服务(F{id}_tcp/_udp), 中继/链等不计入
        if (serviceName == null || !serviceName.startsWith("F")) {
            return;
        }

        String forwardId;
        try {
            forwardId = serviceName.substring(1, serviceName.indexOf('_'));
        } catch (Exception e) {
            return;
        }

        Forward forward = forwardService.getById(forwardId);
        if (forward == null) {
            return;
        }

        synchronized (getForwardLock(forwardId)) {
            UpdateWrapper<Forward> updateWrapper = new UpdateWrapper<>();
            updateWrapper.eq("id", forwardId);
            updateWrapper.setSql("in_flow = in_flow + " + Math.max(0, flowDataList.getD()));
            updateWrapper.setSql("out_flow = out_flow + " + Math.max(0, flowDataList.getU()));
            forwardService.update(null, updateWrapper);
        }
    }

    private Object getForwardLock(String forwardId) {
        return FORWARD_LOCKS.computeIfAbsent(forwardId, k -> new Object());
    }

    private boolean isValidNode(String secret) {
        if (secret == null || secret.isEmpty()) return false;
        int nodeCount = nodeService.count(new QueryWrapper<Node>().eq("secret", secret));
        return nodeCount > 0;
    }
}

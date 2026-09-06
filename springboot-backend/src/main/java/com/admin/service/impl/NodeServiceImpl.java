package com.admin.service.impl;

import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.StrUtil;
import com.admin.common.dto.GostDto;
import com.admin.common.dto.NodeDto;
import com.admin.common.dto.NodeListDto;
import com.admin.common.dto.NodeUpdateDto;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.common.utils.LatencyCache;
import com.admin.common.utils.WebSocketServer;
import com.admin.entity.Node;
import com.admin.entity.ViteConfig;
import com.admin.mapper.LinkMapper;
import com.admin.mapper.NodeMapper;
import com.admin.mapper.NodeWgMapper;
import com.admin.service.NodeService;
import com.admin.service.ViteConfigService;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.beans.BeanUtils;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * <p>
 * 节点服务实现类
 * </p>
 */
@Service
public class NodeServiceImpl extends ServiceImpl<NodeMapper, Node> implements NodeService {

    private static final String CURRENT_AGENT_VERSION = "1.3.4";

    private static final String SUCCESS_CREATE_MSG = "节点创建成功";
    private static final String SUCCESS_UPDATE_MSG = "节点更新成功";
    private static final String SUCCESS_DELETE_MSG = "节点删除成功";

    private static final String ERROR_CREATE_MSG = "节点创建失败";
    private static final String ERROR_UPDATE_MSG = "节点更新失败";
    private static final String ERROR_DELETE_MSG = "节点删除失败";
    private static final String ERROR_NODE_NOT_FOUND = "节点不存在";

    private static final String ERROR_NODE_IN_USE = "该节点还在 %d 条线路中使用, 请先删除相关线路";
    private static final String ERROR_NODE_IN_WG = "该节点还在组网中使用, 请先从组网中移除";

    private static final String ERROR_PORT_STA_REQUIRED = "起始端口不能为空";
    private static final String ERROR_PORT_END_REQUIRED = "结束端口不能为空";
    private static final String ERROR_PORT_RANGE_INVALID = "端口必须在1-65535范围内";
    private static final String ERROR_PORT_ORDER_INVALID = "结束端口不能小于起始端口";

    @Resource
    @Lazy
    private LinkMapper linkMapper;

    @Resource
    private NodeWgMapper nodeWgMapper;

    @Resource
    ViteConfigService viteConfigService;

    @Override
    public R createNode(NodeDto nodeDto) {
        Node node = buildNewNode(nodeDto);
        boolean result = this.save(node);
        return result ? R.ok(SUCCESS_CREATE_MSG) : R.err(ERROR_CREATE_MSG);
    }

    @Override
    public R getAllNodes() {
        List<Node> nodeList = this.list();
        hideNodeSecrets(nodeList);

        List<NodeListDto> result = new ArrayList<>();
        for (Node node : nodeList) {
            NodeListDto dto = new NodeListDto();
            BeanUtils.copyProperties(node, dto);
            dto.setLatency(LatencyCache.getNodeLatency(node.getId()));
            dto.setWgLatencies(new java.util.HashMap<>());
            result.add(dto);
        }
        return R.ok(result);
    }

    @Override
    public R updateNode(NodeUpdateDto nodeUpdateDto) {
        Node node = this.getById(nodeUpdateDto.getId());
        if (node == null) {
            return R.err(ERROR_NODE_NOT_FOUND);
        }

        boolean online = node.getStatus() != null && node.getStatus() == 1;
        Integer newHttp = nodeUpdateDto.getHttp();
        Integer newTls = nodeUpdateDto.getTls();
        Integer newSocks = nodeUpdateDto.getSocks();

        boolean httpChanged = newHttp != null && !newHttp.equals(node.getHttp());
        boolean tlsChanged = newTls != null && !newTls.equals(node.getTls());
        boolean socksChanged = newSocks != null && !newSocks.equals(node.getSocks());

        if (online && (httpChanged || tlsChanged || socksChanged)) {
            JSONObject req = new JSONObject();
            req.put("http", newHttp);
            req.put("tls", newTls);
            req.put("socks", newSocks);

            GostDto gostResult = WebSocketServer.send_msg(node.getId(), req, "SetProtocol");
            if (!Objects.equals(gostResult.getMsg(), "OK")) {
                return R.err(gostResult.getMsg());
            }
        }

        Node updateNode = buildUpdateNode(nodeUpdateDto);
        boolean result = this.updateById(updateNode);
        return result ? R.ok(SUCCESS_UPDATE_MSG) : R.err(ERROR_UPDATE_MSG);
    }

    @Override
    public R deleteNode(Long id) {
        Node node = this.getById(id);
        if (node == null) {
            return R.err(ERROR_NODE_NOT_FOUND);
        }

        R usageCheckResult = checkNodeUsage(id);
        if (usageCheckResult.getCode() != 0) {
            return usageCheckResult;
        }

        boolean result = this.removeById(id);
        LatencyCache.updateNodeLatency(id, null);
        return result ? R.ok(SUCCESS_DELETE_MSG) : R.err(ERROR_DELETE_MSG);
    }

    @Override
    public Node getNodeById(Long id) {
        Node node = this.getById(id);
        if (node == null) {
            throw new RuntimeException(ERROR_NODE_NOT_FOUND);
        }
        return node;
    }

    @Override
    public R getInstallCommand(Long id) {
        Node node = this.getById(id);
        if (node == null) {
            return R.err(ERROR_NODE_NOT_FOUND);
        }

        ViteConfig viteConfig = viteConfigService.getOne(new QueryWrapper<ViteConfig>().eq("name", "ip"));
        if (viteConfig == null) return R.err("请先前往网站配置中设置ip");

        StringBuilder command = new StringBuilder();
        command.append("curl -L https://github.com/charmingyi/dlux/raw/main/install.sh")
               .append(" -o ./install.sh && chmod +x ./install.sh && ");

        String processedServerAddr = processServerAddress(viteConfig.getValue());

        command.append("./install.sh")
               .append(" -a ").append(processedServerAddr)
               .append(" -s ").append(node.getSecret());

        return R.ok(command.toString());
    }

    @Override
    public R updateAgent(Long id) {
        Node node = this.getById(id);
        if (node == null) {
            return R.err(ERROR_NODE_NOT_FOUND);
        }
        if (node.getStatus() == null || node.getStatus() != 1) {
            return R.err("节点不在线, 无法在线更新");
        }
        String version = node.getVersion();
        if (version == null || version.compareTo(CURRENT_AGENT_VERSION) < 0) {
            GostDto result = GostUtil.BootstrapLegacyAgent(node.getId(), CURRENT_AGENT_VERSION);
            if (result == null || !"OK".equals(result.getMsg())) {
                return R.err(result == null ? "旧版节点升级指令发送失败" : result.getMsg());
            }
            return R.ok("兼容升级指令已下发，节点将在下载完成后自动重启");
        }
        GostDto result = GostUtil.UpdateAgent(node.getId(), CURRENT_AGENT_VERSION);
        if (result == null || !"OK".equals(result.getMsg())) {
            return R.err(result == null ? "节点无响应" : result.getMsg());
        }
        return R.ok("更新指令已下发, 节点将自动下载并重启");
    }

    private Node buildNewNode(NodeDto nodeDto) {
        Node node = new Node();
        BeanUtils.copyProperties(nodeDto, node);

        validatePortRange(node.getPortSta(), node.getPortEnd());

        node.setSecret(IdUtil.simpleUUID());
        node.setStatus(0);

        long currentTime = System.currentTimeMillis();
        node.setCreatedTime(currentTime);
        node.setUpdatedTime(currentTime);

        return node;
    }

    private Node buildUpdateNode(NodeUpdateDto nodeUpdateDto) {
        Node node = new Node();
        node.setId(nodeUpdateDto.getId());
        node.setName(nodeUpdateDto.getName());
        node.setIp(nodeUpdateDto.getIp());
        node.setServerIp(nodeUpdateDto.getServerIp());
        node.setPortSta(nodeUpdateDto.getPortSta());
        node.setPortEnd(nodeUpdateDto.getPortEnd());
        node.setHttp(nodeUpdateDto.getHttp());
        node.setTls(nodeUpdateDto.getTls());
        node.setSocks(nodeUpdateDto.getSocks());
        validatePortRange(node.getPortSta(), node.getPortEnd());

        node.setUpdatedTime(System.currentTimeMillis());
        return node;
    }

    private void hideNodeSecrets(List<Node> nodeList) {
        nodeList.forEach(node -> node.setSecret(null));
    }

    private R checkNodeUsage(Long nodeId) {
        Long linkCount = linkMapper.selectLinkCountByNode(nodeId.intValue());
        if (linkCount != null && linkCount > 0) {
            return R.err(String.format(ERROR_NODE_IN_USE, linkCount));
        }

        Integer wgCount = nodeWgMapper.selectCount(new QueryWrapper<com.admin.entity.NodeWg>().eq("node_id", nodeId));
        if (wgCount != null && wgCount > 0) {
            return R.err(ERROR_NODE_IN_WG);
        }
        return R.ok();
    }

    private String processServerAddress(String serverAddr) {
        if (StrUtil.isBlank(serverAddr)) {
            return serverAddr;
        }

        if (serverAddr.startsWith("[")) {
            return serverAddr;
        }

        int lastColonIndex = serverAddr.lastIndexOf(':');
        if (lastColonIndex == -1) {
            return isIPv6Address(serverAddr) ? "[" + serverAddr + "]" : serverAddr;
        }

        String host = serverAddr.substring(0, lastColonIndex);
        String port = serverAddr.substring(lastColonIndex);

        if (isIPv6Address(host)) {
            return "[" + host + "]" + port;
        }

        return serverAddr;
    }

    private boolean isIPv6Address(String address) {
        if (!address.contains(":")) {
            return false;
        }
        long colonCount = address.chars().filter(ch -> ch == ':').count();
        return colonCount >= 2;
    }

    private void validatePortRange(Integer portSta, Integer portEnd) {
        if (portSta == null) {
            throw new RuntimeException(ERROR_PORT_STA_REQUIRED);
        }
        if (portEnd == null) {
            throw new RuntimeException(ERROR_PORT_END_REQUIRED);
        }
        if (portSta < 1 || portSta > 65535 || portEnd < 1 || portEnd > 65535) {
            throw new RuntimeException(ERROR_PORT_RANGE_INVALID);
        }
        if (portEnd < portSta) {
            throw new RuntimeException(ERROR_PORT_ORDER_INVALID);
        }
    }

}

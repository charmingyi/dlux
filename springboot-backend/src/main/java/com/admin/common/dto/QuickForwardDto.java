package com.admin.common.dto;

import lombok.Data;

import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;
import java.util.List;

/**
 * 面向主流转发面板习惯的快速创建请求:
 * 选入口 -> 选落地(可多选负载均衡/直连) -> 填目标, 组网/线路/路由组由后端自动解决。
 */
@Data
public class QuickForwardDto {

    @NotBlank(message = "转发名称不能为空")
    private String name;

    /** 入口节点(客户端连接的服务器) */
    @NotNull(message = "请选择入口节点")
    private Integer entryNodeId;

    /** 落地节点列表; 为空或仅含入口节点时表示直连(入口直接访问目标) */
    private List<Integer> exitNodeIds;

    /** 最终目标地址, 逗号分隔多个 */
    @NotBlank(message = "目标地址不能为空")
    private String remoteAddr;

    /** 入口监听端口, 留空自动分配 */
    @Min(value = 1, message = "端口号不能小于1")
    @Max(value = 65535, message = "端口号不能大于65535")
    private Integer inPort;

    /** 多出口策略, 默认失败切换(fifo) */
    private String groupStrategy;

    /** 多目标策略, 默认fifo */
    private String targetStrategy;

    /** 限速规则ID */
    private Integer speedId;

    /** 高级: 指定使用的组网ID, 留空自动选择 */
    private Integer wgNetworkId;
}

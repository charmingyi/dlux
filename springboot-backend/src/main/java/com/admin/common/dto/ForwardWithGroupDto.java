package com.admin.common.dto;

import lombok.Data;

/**
 * <p>
 * 转发信息及关联组/线路信息DTO
 * </p>
 */
@Data
public class ForwardWithGroupDto {

    private Long id;

    private String name;

    /** 入口监听端口 */
    private Integer inPort;

    /** 目标地址 */
    private String remoteAddr;

    /** 转发状态 */
    private Integer status;

    private Long createdTime;

    private Long updatedTime;

    /** 目标选择策略 */
    private String targetStrategy;

    /** 限速规则ID */
    private Integer speedId;

    private String speedName;

    private String interfaceName;

    private Long inFlow;

    private Long outFlow;

    private Integer inx;

    // 以下为组相关信息

    private Integer groupId;

    /** 组名称 */
    private String groupName;

    /** 组策略 round/random/fifo/hash/latency */
    private String groupStrategy;

    /** 组内线路数 */
    private Integer linkCount;

    /** 入口节点ID(组内线路必须一致) */
    private Integer entryNodeId;

    /** 入口节点名称 */
    private String entryNodeName;

    /** 入口节点在线状态 */
    private Integer entryNodeStatus;

    /** 各线路出口节点到目标的延迟探测 */
    private java.util.List<java.util.Map<String, Object>> targetLatencies;

}

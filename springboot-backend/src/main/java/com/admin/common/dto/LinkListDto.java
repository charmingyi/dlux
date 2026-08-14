package com.admin.common.dto;

import lombok.Data;

/**
 * <p>
 * 线路列表DTO(含节点名称与中继信息)
 * </p>
 */
@Data
public class LinkListDto {

    private Long id;

    private String name;

    private Integer wgNetworkId;

    private String wgNetworkName;

    private String transport;

    private Integer entryNodeId;

    private String entryNodeName;

    private Integer entryNodeStatus;

    private Integer exitNodeId;

    private String exitNodeName;

    private Integer exitNodeStatus;

    /** 中间节点ID JSON */
    private String hopNodeIds;

    /** 中间节点名称列表 */
    private String hopNodeNames;

    /** 节点数(含入口出口) */
    private Integer nodeCount;

    private Integer status;

    private Long createdTime;

    private Long updatedTime;

    /** 组网IP(入口节点在该组网内的IP) */
    private String entryWgIp;

    /** 入口节点到各中继点的延迟(ms), 探测缓存 */
    private java.util.Map<String, Object> latencies;

}

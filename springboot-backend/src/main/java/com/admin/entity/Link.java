package com.admin.entity;

import java.io.Serializable;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * <p>
 * 线路: 入口 -> 中间节点 -> 出口(落地)
 * </p>
 */
@Data
@EqualsAndHashCode(callSuper = false)
public class Link extends BaseEntity {

    private static final long serialVersionUID = 1L;

    private String name;

    /** 使用的组网, 为空表示直连 */
    private Integer wgNetworkId;

    /** 节点间传输: wg/tls/tcp */
    private String transport;

    /** 入口节点 */
    private Integer entryNodeId;

    /** 出口(落地)节点 */
    private Integer exitNodeId;

    /** 中间节点ID列表JSON, 如 [2,3] */
    private String hopNodeIds;

}

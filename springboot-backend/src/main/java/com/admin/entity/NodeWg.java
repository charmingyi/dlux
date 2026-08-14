package com.admin.entity;

import java.io.Serializable;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * <p>
 * 组网成员节点
 * </p>
 */
@Data
@EqualsAndHashCode(callSuper = false)
public class NodeWg extends BaseEntity {

    private static final long serialVersionUID = 1L;

    private Integer wgNetworkId;

    private Integer nodeId;

    /** 组网内IP, 如 10.10.0.2 */
    private String ip;

    /** hub模式下是否为中心节点 */
    private Integer hub;

    /** 节点公钥(由节点端生成并上报) */
    private String publicKey;

}

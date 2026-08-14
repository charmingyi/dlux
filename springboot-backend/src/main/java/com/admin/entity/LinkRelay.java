package com.admin.entity;

import java.io.Serializable;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * <p>
 * 线路中继服务(每个非入口节点一个)
 * </p>
 */
@Data
@EqualsAndHashCode(callSuper = false)
public class LinkRelay extends BaseEntity {

    private static final long serialVersionUID = 1L;

    private Integer linkId;

    private Integer nodeId;

    /** 中继监听端口 */
    private Integer port;

    /** 监听地址(组网IP或0.0.0.0) */
    private String addr;

    /** 监听协议 tcp/tls */
    private String protocol;

}

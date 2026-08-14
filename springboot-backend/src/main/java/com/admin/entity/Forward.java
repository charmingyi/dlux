package com.admin.entity;

import java.io.Serializable;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * <p>
 * 端口转发
 * </p>
 */
@Data
@EqualsAndHashCode(callSuper = false)
public class Forward extends BaseEntity{

    private static final long serialVersionUID = 1L;

    private String name;

    /** 所属负载均衡组 */
    private Integer groupId;

    /** 入口监听端口 */
    private Integer inPort;

    /** 目标地址列表, 逗号分隔 */
    private String remoteAddr;

    /** 目标选择策略 round/random/fifo/hash/latency */
    private String targetStrategy;

    /** 限速规则ID */
    private Integer speedId;

    /** 入口网卡绑定 */
    private String interfaceName;

    private Long inFlow;

    private Long outFlow;

    private Integer inx;

}

package com.admin.entity;

import java.io.Serializable;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * <p>
 * 负载均衡组
 * </p>
 */
@Data
@EqualsAndHashCode(callSuper = false)
public class LbGroup extends BaseEntity {

    private static final long serialVersionUID = 1L;

    private String name;

    /** round/random/fifo/hash/latency */
    private String strategy;

    /** 连续失败次数后摘除 */
    private Integer maxFails;

    /** 摘除后的恢复时间, 如 600s */
    private String failTimeout;

}

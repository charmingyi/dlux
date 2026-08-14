package com.admin.entity;

import java.io.Serializable;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * <p>
 * 组内线路
 * </p>
 */
@Data
@EqualsAndHashCode(callSuper = false)
public class GroupLink extends BaseEntity {

    private static final long serialVersionUID = 1L;

    private Integer groupId;

    private Integer linkId;

    /** 权重(random策略使用) */
    private Integer weight;

    private Integer inx;

}

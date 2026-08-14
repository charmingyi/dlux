package com.admin.common.dto;

import lombok.Data;

/**
 * <p>
 * 负载均衡组列表DTO
 * </p>
 */
@Data
public class GroupListDto {

    private Long id;

    private String name;

    private String strategy;

    private Integer maxFails;

    private String failTimeout;

    private Integer status;

    private Long createdTime;

    /** 组内线路数 */
    private Integer linkCount;

    /** 使用该组的转发数 */
    private Integer forwardCount;

    /** 组内线路(简化信息) */
    private java.util.List<java.util.Map<String, Object>> links;

}

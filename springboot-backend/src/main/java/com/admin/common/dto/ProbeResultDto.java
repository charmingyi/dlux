package com.admin.common.dto;

import lombok.Data;

/**
 * <p>
 * 探测结果项(节点上报)
 * </p>
 */
@Data
public class ProbeResultDto {

    private String key;

    private String addr;

    private Double ms;

    private Boolean up;

}

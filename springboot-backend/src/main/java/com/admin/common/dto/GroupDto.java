package com.admin.common.dto;

import lombok.Data;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

@Data
public class GroupDto {

    @NotBlank(message = "组名称不能为空")
    private String name;

    /** round/random/fifo/hash/latency */
    @NotBlank(message = "策略不能为空")
    private String strategy;

    /** 连续失败次数后摘除 */
    private Integer maxFails;

    /** 摘除后的恢复时间 */
    private String failTimeout;

    /** 组内线路ID列表 */
    private java.util.List<Integer> linkIds;

    /** 线路权重, 与linkIds对应 */
    private java.util.List<Integer> weights;

}

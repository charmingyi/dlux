package com.admin.common.dto;

import lombok.Data;

import javax.validation.Valid;
import javax.validation.constraints.Max;
import javax.validation.constraints.Min;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotEmpty;
import javax.validation.constraints.NotNull;
import java.util.List;

/**
 * 以转发任务为中心的一体化创建请求。
 * 后端负责一次性创建线路、负载均衡组和转发，并在失败时逆序清理。
 */
@Data
public class ForwardPlanDto {

    @NotBlank(message = "转发名称不能为空")
    private String name;

    @NotNull(message = "入口节点不能为空")
    private Integer entryNodeId;

    @NotNull(message = "WireGuard组网不能为空")
    private Integer wgNetworkId;

    @Valid
    @NotEmpty(message = "至少需要一条线路")
    private List<ForwardPlanRouteDto> routes;

    private String groupStrategy;

    private Integer maxFails;

    private String failTimeout;

    @NotBlank(message = "目标地址不能为空")
    private String remoteAddr;

    private String targetStrategy;

    private Integer speedId;

    @Min(value = 1, message = "端口号不能小于1")
    @Max(value = 65535, message = "端口号不能大于65535")
    private Integer inPort;
}

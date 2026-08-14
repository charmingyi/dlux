package com.admin.common.dto;

import lombok.Data;
import javax.validation.constraints.Min;
import javax.validation.constraints.Max;

@Data
public class ForwardUpdateDto {

    @javax.validation.constraints.NotNull(message = "转发ID不能为空")
    private Long id;

    private String name;

    private Integer groupId;

    private String remoteAddr;

    /** 目标选择策略 */
    private String targetStrategy;

    private Integer speedId;

    @Min(value = 1, message = "端口号不能小于1")
    @Max(value = 65535, message = "端口号不能大于65535")
    private Integer inPort;

    private String interfaceName;

}

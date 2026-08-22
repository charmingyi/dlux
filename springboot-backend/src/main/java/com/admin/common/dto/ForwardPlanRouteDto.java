package com.admin.common.dto;

import lombok.Data;

import javax.validation.constraints.NotNull;
import java.util.List;

/** 一体化转发向导中的一条完整路径：入口 -> 中间节点 -> 出口。 */
@Data
public class ForwardPlanRouteDto {

    private String name;

    @NotNull(message = "线路出口节点不能为空")
    private Integer exitNodeId;

    private List<Integer> hopNodeIds;

    private Integer weight;

    /** 传输方式 wg/tls/tcp, 为空时按wg处理 */
    private String transport;
}

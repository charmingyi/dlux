package com.admin.common.dto;

import lombok.Data;
import javax.validation.constraints.NotBlank;
import javax.validation.constraints.NotNull;

@Data
public class LinkDto {

    @NotBlank(message = "线路名称不能为空")
    private String name;

    /** 使用的组网ID, 直连时为空 */
    private Integer wgNetworkId;

    /** 节点间传输: wg/tls/tcp, 默认 wg */
    private String transport;

    @NotNull(message = "入口节点不能为空")
    private Integer entryNodeId;

    @NotNull(message = "出口节点不能为空")
    private Integer exitNodeId;

    /** 中间节点ID列表, 按顺序 */
    private java.util.List<Integer> hopNodeIds;

}

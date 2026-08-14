package com.admin.common.dto;

import lombok.Data;

/**
 * <p>
 * 节点列表DTO(含实时延迟)
 * </p>
 */
@Data
public class NodeListDto {

    private Long id;

    private String name;

    private String ip;

    private String serverIp;

    private String version;

    private Integer portSta;

    private Integer portEnd;

    private Integer http;

    private Integer tls;

    private Integer socks;

    private Integer status;

    private Long createdTime;

    private Long updatedTime;

    /** 面板到节点的延迟(ms), 由定时探测缓存 */
    private Long latency;

    /** 节点到组网内其他节点的延迟 */
    private java.util.Map<String, Object> wgLatencies;

}

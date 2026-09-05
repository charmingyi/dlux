package com.admin.common.dto;

import lombok.Data;

/**
 * <p>
 * 组网成员DTO
 * </p>
 */
@Data
public class WgMemberDto {

    private Long id;

    private Integer nodeId;

    private String nodeName;

    private String nodeServerIp;

    private Integer nodeStatus;

    /** 组网内IP */
    private String ip;

    /** 是否中心节点(hub模式) */
    private Integer hub;

    /** 节点公钥 */
    private String publicKey;

    /** 出口线路: 空=不管理, auto=自动故障切换, 其他=指定网卡名 */
    private String egress;

    /** 组网是否已在该节点应用 */
    private Integer applied;

    /** 到组网内其他节点的延迟 (key=wg:{netId}:{nodeId}:{ip}) */
    private java.util.Map<String, Object> latencies;

}

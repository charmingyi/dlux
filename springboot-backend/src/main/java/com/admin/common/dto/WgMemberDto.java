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

    /** 组网是否已在该节点应用 */
    private Integer applied;

}

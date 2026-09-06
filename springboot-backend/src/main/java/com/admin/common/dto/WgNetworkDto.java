package com.admin.common.dto;

import lombok.Data;

/**
 * <p>
 * WireGuard组网DTO(含成员信息)
 * </p>
 */
@Data
public class WgNetworkDto {

    private Long id;

    private String name;

    private String subnet;

    private String mode;

    private Integer listenPort;

    private Integer mtu;

    /** 传输封装: udp=原生UDP直连, wss=WebSocket/TCP封装 */
    private String transport;

    private Integer status;

    private Long createdTime;

    private Long updatedTime;

    /** 成员节点 */
    private java.util.List<WgMemberDto> members;

}

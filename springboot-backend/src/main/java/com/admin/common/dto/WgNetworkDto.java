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

    private Integer status;

    private Long createdTime;

    private Long updatedTime;

    /** 成员节点 */
    private java.util.List<WgMemberDto> members;

}

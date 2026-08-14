package com.admin.entity;

import java.io.Serializable;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * <p>
 * WireGuard组网
 * </p>
 */
@Data
@EqualsAndHashCode(callSuper = false)
public class WgNetwork extends BaseEntity {

    private static final long serialVersionUID = 1L;

    private String name;

    /** 组网网段, 如 10.10.0.0/24 */
    private String subnet;

    /** mesh=全互联, hub=中心-分支 */
    private String mode;

    /** UDP监听端口 */
    private Integer listenPort;

    /** 接口MTU */
    private Integer mtu;

}

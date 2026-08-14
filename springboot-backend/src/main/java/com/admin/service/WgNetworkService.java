package com.admin.service;

import com.admin.common.dto.WgNetworkDto;
import com.admin.common.lang.R;
import com.admin.entity.WgNetwork;
import com.baomidou.mybatisplus.extension.service.IService;

/**
 * <p>
 * WireGuard组网服务类
 * </p>
 */
public interface WgNetworkService extends IService<WgNetwork> {

    R createNetwork(WgNetworkDto dto);

    R getAllNetworks();

    R updateNetwork(Long id, WgNetworkDto dto);

    R deleteNetwork(Long id);

    /** 应用/同步组网到所有成员节点(两阶段: 先取公钥, 再下发完整对端配置) */
    R syncNetwork(Long id);

}

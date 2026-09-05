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

    /** 查询所有成员节点上的真实 WireGuard 运行状态。 */
    R getNetworkStatus(Long id);

    /** 设置成员到对端的出口线路(egress: ""=清除, "auto"=自动故障切换, 其他=网卡名)。 */
    R setMemberEgress(Long networkId, Integer nodeId, String egress);

    /** 查询节点候选出口网卡。 */
    R listNodeEgressIfaces(Integer nodeId);

}

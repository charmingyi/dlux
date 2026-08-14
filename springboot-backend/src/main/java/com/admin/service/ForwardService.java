package com.admin.service;

import com.admin.common.dto.ForwardDto;
import com.admin.common.dto.ForwardUpdateDto;
import com.admin.common.lang.R;
import com.admin.entity.Forward;
import com.baomidou.mybatisplus.extension.service.IService;

import java.util.List;
import java.util.Map;

/**
 * <p>
 * 端口转发服务类
 * </p>
 */
public interface ForwardService extends IService<Forward> {

    R createForward(ForwardDto forwardDto);

    R getAllForwards();

    R updateForward(ForwardUpdateDto forwardUpdateDto);

    R deleteForward(Long id);

    R forceDeleteForward(Long id);

    R pauseForward(Long id);

    R resumeForward(Long id);

    R diagnoseForward(Long id);

    R updateForwardOrder(Map<String, Object> params);

    /** 重新下发某组的所有转发 */
    R redeployGroup(Long groupId);

    /** 下发/更新一个转发的完整配置(链+入口服务), 供组/线路变化后调用 */
    R deployForward(Forward forward);

    /** 更新转发相关的探测配置到各节点 */
    void pushProbes(Forward forward);
}

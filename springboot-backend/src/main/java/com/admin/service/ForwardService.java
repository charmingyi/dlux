package com.admin.service;

import com.admin.common.dto.ForwardDto;
import com.admin.common.dto.ForwardPlanDto;
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

    /** 一次性创建线路、负载均衡组和转发任务。 */
    R createForwardPlan(ForwardPlanDto planDto);

    /** 快速创建: 入口+落地+目标, 组网/线路/组自动解决(主流面板式) */
    R quickCreateForward(com.admin.common.dto.QuickForwardDto dto);

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

    /** 克隆一条转发(复用组/目标/策略, 自动分配新端口) */
    R cloneForward(Long id);

    /** 批量操作 pause/resume/delete */
    R batchOperation(Map<String, Object> params);

    /** 导出全部转发为可迁移JSON */
    R exportForwards();

    /** 导入转发JSON(复用一体化创建, 原子回滚) */
    R importForwards(Map<String, Object> params);

    /** 重新下发单个转发(保持暂停态) */
    R redeployForward(Long id);

    /** 下发/更新一个转发的完整配置(链+入口服务), 供组/线路变化后调用 */
    R deployForward(Forward forward);

    /** 更新转发相关的探测配置到各节点 */
    void pushProbes(Forward forward);
}

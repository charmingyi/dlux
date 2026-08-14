package com.admin.service.impl;

import com.admin.common.dto.GostDto;
import com.admin.common.dto.SpeedLimitDto;
import com.admin.common.dto.SpeedLimitUpdateDto;
import com.admin.common.lang.R;
import com.admin.common.utils.GostUtil;
import com.admin.entity.Forward;
import com.admin.entity.Node;
import com.admin.entity.SpeedLimit;
import com.admin.mapper.SpeedLimitMapper;
import com.admin.service.ForwardService;
import com.admin.service.NodeService;
import com.admin.service.SpeedLimitService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Objects;

/**
 * <p>
 * 限速规则服务实现类
 * 限速规则按ID全局推送至所有在线节点, 由转发服务引用
 * </p>
 */
@Slf4j
@Service
public class SpeedLimitServiceImpl extends ServiceImpl<SpeedLimitMapper, SpeedLimit> implements SpeedLimitService {

    private static final String GOST_SUCCESS_MSG = "OK";
    private static final String GOST_NOT_FOUND_MSG = "not found";

    private static final int SPEED_LIMIT_ACTIVE_STATUS = 1;
    private static final int SPEED_LIMIT_INACTIVE_STATUS = 0;

    private static final String SUCCESS_UPDATE_MSG = "限速规则更新成功";
    private static final String SUCCESS_DELETE_MSG = "限速规则删除成功";

    private static final String ERROR_CREATE_MSG = "限速规则创建失败";
    private static final String ERROR_UPDATE_MSG = "限速规则更新失败";
    private static final String ERROR_DELETE_MSG = "限速规则删除失败";
    private static final String ERROR_SPEED_LIMIT_NOT_FOUND = "限速规则不存在";
    private static final String ERROR_SPEED_LIMIT_IN_USE = "该限速规则正在被转发使用, 请先取消绑定";

    @Resource
    private NodeService nodeService;

    @Resource
    @Lazy
    private ForwardService forwardService;

    @Override
    public R createSpeedLimit(SpeedLimitDto speedLimitDto) {
        SpeedLimit speedLimit = new SpeedLimit();
        BeanUtils.copyProperties(speedLimitDto, speedLimit);
        long currentTime = System.currentTimeMillis();
        speedLimit.setCreatedTime(currentTime);
        speedLimit.setUpdatedTime(currentTime);
        speedLimit.setStatus(SPEED_LIMIT_ACTIVE_STATUS);

        if (!this.save(speedLimit)) {
            return R.err(ERROR_CREATE_MSG);
        }

        R gostResult = pushLimiterToNodes(speedLimit.getId(), convertToMbps(speedLimit.getSpeed()), true);
        if (gostResult.getCode() != 0) {
            this.removeById(speedLimit.getId());
            return gostResult;
        }
        return R.ok();
    }

    @Override
    public R getAllSpeedLimits() {
        return R.ok(this.list(new QueryWrapper<SpeedLimit>().orderByDesc("created_time")));
    }

    @Override
    public R updateSpeedLimit(SpeedLimitUpdateDto speedLimitUpdateDto) {
        SpeedLimit speedLimit = this.getById(speedLimitUpdateDto.getId());
        if (speedLimit == null) {
            return R.err(ERROR_SPEED_LIMIT_NOT_FOUND);
        }

        BeanUtils.copyProperties(speedLimitUpdateDto, speedLimit);
        speedLimit.setUpdatedTime(System.currentTimeMillis());

        R gostResult = pushLimiterToNodes(speedLimit.getId(), convertToMbps(speedLimit.getSpeed()), false);
        if (gostResult.getCode() != 0) {
            return gostResult;
        }

        boolean result = this.updateById(speedLimit);
        return result ? R.ok(SUCCESS_UPDATE_MSG) : R.err(ERROR_UPDATE_MSG);
    }

    @Override
    public R deleteSpeedLimit(Long id) {
        SpeedLimit speedLimit = this.getById(id);
        if (speedLimit == null) {
            return R.err(ERROR_SPEED_LIMIT_NOT_FOUND);
        }

        long useCount = forwardService.count(new QueryWrapper<Forward>().eq("speed_id", id));
        if (useCount > 0) {
            return R.err(ERROR_SPEED_LIMIT_IN_USE);
        }

        List<Node> nodes = nodeService.list(new QueryWrapper<Node>().eq("status", 1));
        for (Node node : nodes) {
            try {
                GostUtil.DeleteLimiters(node.getId(), id);
            } catch (Exception e) {
                log.warn("删除限速器失败 node={} limiter={}: {}", node.getId(), id, e.getMessage());
            }
        }

        boolean result = this.removeById(id);
        return result ? R.ok(SUCCESS_DELETE_MSG) : R.err(ERROR_DELETE_MSG);
    }

    /**
     * 将限速器推送到所有在线节点
     */
    private R pushLimiterToNodes(Long id, String speed, boolean isAdd) {
        List<Node> nodes = nodeService.list(new QueryWrapper<Node>().eq("status", 1));
        for (Node node : nodes) {
            GostDto result;
            if (isAdd) {
                result = GostUtil.AddLimiters(node.getId(), id, speed);
            } else {
                result = GostUtil.UpdateLimiters(node.getId(), id, speed);
                if (result.getMsg().contains(GOST_NOT_FOUND_MSG)) {
                    result = GostUtil.AddLimiters(node.getId(), id, speed);
                }
            }
            if (!isGostOperationSuccess(result)) {
                log.warn("推送限速器失败 node={}: {}", node.getId(), result.getMsg());
            }
        }
        return R.ok();
    }

    private String convertToMbps(Integer speed) {
        return new BigDecimal(speed).setScale(1, RoundingMode.HALF_UP).toPlainString();
    }

    private boolean isGostOperationSuccess(GostDto gostResult) {
        return Objects.equals(gostResult.getMsg(), GOST_SUCCESS_MSG);
    }
}

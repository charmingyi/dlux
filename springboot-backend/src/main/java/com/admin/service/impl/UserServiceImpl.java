package com.admin.service.impl;

import cloud.tianai.captcha.application.ImageCaptchaApplication;
import cloud.tianai.captcha.spring.plugins.secondary.SecondaryVerificationApplication;
import cn.hutool.core.map.MapUtil;
import com.admin.common.dto.ChangePasswordDto;
import com.admin.common.dto.LoginDto;
import com.admin.common.lang.R;
import com.admin.common.utils.JwtUtil;
import com.admin.common.utils.Md5Util;
import com.admin.entity.Forward;
import com.admin.entity.Node;
import com.admin.entity.SpeedLimit;
import com.admin.entity.StatisticsFlow;
import com.admin.entity.User;
import com.admin.entity.ViteConfig;
import com.admin.entity.WgNetwork;
import com.admin.mapper.ForwardMapper;
import com.admin.mapper.UserMapper;
import com.admin.service.NodeService;
import com.admin.service.SpeedLimitService;
import com.admin.service.StatisticsFlowService;
import com.admin.service.UserService;
import com.admin.service.ViteConfigService;
import com.admin.service.WgNetworkService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * <p>
 * 用户服务实现类(单管理员模式)
 * 仅保留登录与账号密码修改
 * </p>
 */
@Slf4j
@Service
public class UserServiceImpl extends ServiceImpl<UserMapper, User> implements UserService {

    private static final int USER_STATUS_DISABLED = 0;

    private static final String ERROR_LOGIN_CREDENTIALS = "账号或密码错误";
    private static final String ERROR_ACCOUNT_DISABLED = "账户停用";
    private static final String ERROR_PASSWORD_NOT_MATCH = "新密码和确认密码不匹配";
    private static final String ERROR_CURRENT_PASSWORD_WRONG = "当前密码错误";
    private static final String ERROR_UPDATE_FAILED = "修改失败";
    private static final String ERROR_USERNAME_TAKEN = "用户名已被使用";

    private static final String DEFAULT_USERNAME = "admin_user";
    private static final String DEFAULT_PASSWORD = "admin_user";

    @Resource
    private ViteConfigService viteConfigService;

    @Resource
    private NodeService nodeService;

    @Resource
    private ForwardMapper forwardMapper;

    @Resource
    private StatisticsFlowService statisticsFlowService;

    @Resource
    private WgNetworkService wgNetworkService;

    @Resource
    private SpeedLimitService speedLimitService;

    @Resource
    private ImageCaptchaApplication application;

    @Override
    public R login(LoginDto loginDto) {
        ViteConfig viteConfig = viteConfigService.getOne(new QueryWrapper<ViteConfig>().eq("name", "captcha_enabled"));
        if (viteConfig != null && Objects.equals(viteConfig.getValue(), "true")) {
            if (StringUtils.isBlank(loginDto.getCaptchaId())) return R.err("验证码校验失败");
            boolean valid = ((SecondaryVerificationApplication) application).secondaryVerification(loginDto.getCaptchaId());
            if (!valid) return R.err("验证码校验失败");
        }

        User user = this.getOne(new QueryWrapper<User>().eq("user", loginDto.getUsername()));
        if (user == null) {
            return R.err(ERROR_LOGIN_CREDENTIALS);
        }
        if (!user.getPwd().equals(Md5Util.md5(loginDto.getPassword()))) {
            return R.err(ERROR_LOGIN_CREDENTIALS);
        }
        if (user.getStatus() == USER_STATUS_DISABLED) {
            return R.err(ERROR_ACCOUNT_DISABLED);
        }

        String token = JwtUtil.generateToken(user);
        boolean requirePasswordChange = DEFAULT_USERNAME.equals(loginDto.getUsername()) || DEFAULT_PASSWORD.equals(loginDto.getPassword());

        return R.ok(MapUtil.builder()
                .put("token", token)
                .put("name", user.getUser())
                .put("role_id", user.getRoleId())
                .put("requirePasswordChange", requirePasswordChange)
                .build());
    }

    @Override
    public R updatePassword(ChangePasswordDto changePasswordDto) {
        Integer userId = JwtUtil.getUserIdFromToken();
        if (userId == null) {
            return R.err("未登录或token无效");
        }
        User user = this.getById(userId);
        if (user == null) {
            return R.err("用户不存在");
        }

        if (!changePasswordDto.getNewPassword().equals(changePasswordDto.getConfirmPassword())) {
            return R.err(ERROR_PASSWORD_NOT_MATCH);
        }

        if (!user.getPwd().equals(Md5Util.md5(changePasswordDto.getCurrentPassword()))) {
            return R.err(ERROR_CURRENT_PASSWORD_WRONG);
        }

        if (!user.getUser().equals(changePasswordDto.getNewUsername())) {
            long exists = this.count(new QueryWrapper<User>().eq("user", changePasswordDto.getNewUsername()).ne("id", user.getId()));
            if (exists > 0) {
                return R.err(ERROR_USERNAME_TAKEN);
            }
        }

        User updateUser = new User();
        updateUser.setId(user.getId());
        updateUser.setUser(changePasswordDto.getNewUsername());
        updateUser.setPwd(Md5Util.md5(changePasswordDto.getNewPassword()));
        updateUser.setUpdatedTime(System.currentTimeMillis());

        boolean result = this.updateById(updateUser);
        return result ? R.ok("账号密码修改成功") : R.err(ERROR_UPDATE_FAILED);
    }

    /**
     * 面板概览(仪表盘用): 节点/转发统计 + 24小时流量
     */
    @Override
    public R getPanelOverview() {
        Map<String, Object> data = new HashMap<>();

        long nodeCount = nodeService.count(new QueryWrapper<Node>());
        long onlineNodeCount = nodeService.count(new QueryWrapper<Node>().eq("status", 1));
        long forwardCount = forwardMapper.selectCount(new QueryWrapper<Forward>().eq("status", 1));
        long totalForwardCount = forwardMapper.selectCount(new QueryWrapper<Forward>());

        List<Forward> forwards = forwardMapper.selectList(new QueryWrapper<Forward>().orderByDesc("created_time"));
        long totalInFlow = 0;
        long totalOutFlow = 0;
        for (Forward forward : forwards) {
            totalInFlow += forward.getInFlow() == null ? 0 : forward.getInFlow();
            totalOutFlow += forward.getOutFlow() == null ? 0 : forward.getOutFlow();
        }

        data.put("nodeCount", nodeCount);
        data.put("onlineNodeCount", onlineNodeCount);
        data.put("forwardCount", forwardCount);
        data.put("totalForwardCount", totalForwardCount);
        data.put("totalInFlow", totalInFlow);
        data.put("totalOutFlow", totalOutFlow);

        // 状态细分与资源统计
        long pausedCount = forwardMapper.selectCount(new QueryWrapper<Forward>().eq("status", 0));
        long errorCount = forwardMapper.selectCount(new QueryWrapper<Forward>().eq("status", -1));
        data.put("pausedCount", pausedCount);
        data.put("errorCount", errorCount);
        data.put("wgNetworkCount", wgNetworkService.count(new QueryWrapper<WgNetwork>()));
        data.put("speedLimitCount", speedLimitService.count(new QueryWrapper<SpeedLimit>()));

        // 流量Top转发
        List<Forward> sorted = new ArrayList<>(forwards);
        sorted.sort((a, b) -> Long.compare(
                (b.getInFlow() == null ? 0 : b.getInFlow()) + (b.getOutFlow() == null ? 0 : b.getOutFlow()),
                (a.getInFlow() == null ? 0 : a.getInFlow()) + (a.getOutFlow() == null ? 0 : a.getOutFlow())));
        List<Map<String, Object>> topForwards = new ArrayList<>();
        for (Forward f : sorted.subList(0, Math.min(5, sorted.size()))) {
            Map<String, Object> t = new HashMap<>();
            t.put("id", f.getId());
            t.put("name", f.getName());
            t.put("inPort", f.getInPort());
            t.put("status", f.getStatus());
            t.put("inFlow", f.getInFlow());
            t.put("outFlow", f.getOutFlow());
            topForwards.add(t);
        }
        data.put("topForwards", topForwards);

        // 24小时流量
        List<StatisticsFlow> recent = statisticsFlowService.list(
                new QueryWrapper<StatisticsFlow>().orderByDesc("id").last("LIMIT 24"));
        Map<String, Long> hourFlow = new java.util.LinkedHashMap<>();
        java.time.LocalDateTime now = java.time.LocalDateTime.now();
        for (int i = 23; i >= 0; i--) {
            java.time.LocalDateTime t = now.minusHours(i);
            hourFlow.put(String.format("%02d:00", t.getHour()), 0L);
        }
        for (StatisticsFlow sf : recent) {
            String key = sf.getTime() == null ? "" : sf.getTime();
            hourFlow.merge(key, sf.getFlow() == null ? 0L : sf.getFlow(), Long::sum);
        }
        List<Map<String, Object>> chart = new ArrayList<>();
        for (Map.Entry<String, Long> entry : hourFlow.entrySet()) {
            Map<String, Object> item = new HashMap<>();
            item.put("time", entry.getKey());
            item.put("flow", entry.getValue());
            chart.add(item);
        }
        data.put("statistics", chart);
        return R.ok(data);
    }

}

package com.admin.service;

import com.admin.common.dto.ChangePasswordDto;
import com.admin.common.dto.LoginDto;
import com.admin.common.lang.R;
import com.admin.entity.User;
import com.baomidou.mybatisplus.extension.service.IService;

/**
 * <p>
 *  服务类(单管理员)
 * </p>
 */
public interface UserService extends IService<User> {

    R login(LoginDto loginDto);

    R updatePassword(ChangePasswordDto changePasswordDto);

    /** 面板概览(仪表盘用) */
    R getPanelOverview();
}

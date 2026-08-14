package com.admin.controller;


import com.admin.common.aop.LogAnnotation;
import com.admin.common.dto.ChangePasswordDto;
import com.admin.common.dto.LoginDto;
import com.admin.common.lang.R;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

/**
 * <p>
 *  用户控制器(单管理员)
 * </p>
 */
@RestController
@CrossOrigin
@RequestMapping("/api/v1/user")
public class UserController extends BaseController {

    @LogAnnotation
    @PostMapping("/login")
    public R login(@Validated @RequestBody LoginDto loginDto) {
        return userService.login(loginDto);
    }

    @LogAnnotation
    @PostMapping("/updatePassword")
    public R updatePassword(@Validated @RequestBody ChangePasswordDto changePasswordDto) {
        return userService.updatePassword(changePasswordDto);
    }

    @LogAnnotation
    @PostMapping("/overview")
    public R overview() {
        return userService.getPanelOverview();
    }

}

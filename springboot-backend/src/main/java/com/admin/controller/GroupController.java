package com.admin.controller;

import com.admin.common.aop.LogAnnotation;
import com.admin.common.annotation.RequireRole;
import com.admin.common.dto.GroupDto;
import com.admin.common.lang.R;
import com.admin.service.LbGroupService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * <p>
 * 负载均衡组控制器
 * </p>
 */
@RestController
@RequestMapping("/api/v1/group")
@CrossOrigin
public class GroupController extends BaseController {

    @Autowired
    private LbGroupService lbGroupService;

    @LogAnnotation
    @RequireRole
    @PostMapping("/create")
    public R create(@Validated @RequestBody GroupDto groupDto) {
        return lbGroupService.createGroup(groupDto);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/list")
    public R list() {
        return lbGroupService.getAllGroups();
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/update")
    public R update(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        GroupDto groupDto = com.alibaba.fastjson.JSON.parseObject(
                com.alibaba.fastjson.JSON.toJSONString(params), GroupDto.class);
        return lbGroupService.updateGroup(id, groupDto);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/delete")
    public R delete(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return lbGroupService.deleteGroup(id);
    }

}

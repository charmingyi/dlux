package com.admin.controller;

import com.admin.common.aop.LogAnnotation;
import com.admin.common.annotation.RequireRole;
import com.admin.common.dto.LinkDto;
import com.admin.common.lang.R;
import com.admin.service.LinkService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * <p>
 * 线路控制器
 * </p>
 */
@RestController
@RequestMapping("/api/v1/link")
@CrossOrigin
public class LinkController extends BaseController {

    @Autowired
    private LinkService linkService;

    @LogAnnotation
    @RequireRole
    @PostMapping("/create")
    public R create(@Validated @RequestBody LinkDto linkDto) {
        return linkService.createLink(linkDto);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/list")
    public R list() {
        return linkService.getAllLinks();
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/update")
    public R update(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        LinkDto linkDto = com.alibaba.fastjson.JSON.parseObject(
                com.alibaba.fastjson.JSON.toJSONString(params), LinkDto.class);
        return linkService.updateLink(id, linkDto);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/delete")
    public R delete(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return linkService.deleteLink(id);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/redeploy")
    public R redeploy(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return linkService.redeployLink(id);
    }

}

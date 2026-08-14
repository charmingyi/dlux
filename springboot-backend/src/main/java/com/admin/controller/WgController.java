package com.admin.controller;

import com.admin.common.aop.LogAnnotation;
import com.admin.common.annotation.RequireRole;
import com.admin.common.dto.WgNetworkDto;
import com.admin.common.lang.R;
import com.admin.service.WgNetworkService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * <p>
 * WireGuard组网控制器
 * </p>
 */
@RestController
@RequestMapping("/api/v1/wg")
@CrossOrigin
public class WgController extends BaseController {

    @Autowired
    private WgNetworkService wgNetworkService;

    @LogAnnotation
    @RequireRole
    @PostMapping("/create")
    public R create(@Validated @RequestBody WgNetworkDto dto) {
        return wgNetworkService.createNetwork(dto);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/list")
    public R list() {
        return wgNetworkService.getAllNetworks();
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/update")
    public R update(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        WgNetworkDto dto = com.alibaba.fastjson.JSON.parseObject(
                com.alibaba.fastjson.JSON.toJSONString(params), WgNetworkDto.class);
        return wgNetworkService.updateNetwork(id, dto);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/delete")
    public R delete(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return wgNetworkService.deleteNetwork(id);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/sync")
    public R sync(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return wgNetworkService.syncNetwork(id);
    }

    @RequireRole
    @PostMapping("/status")
    public R status(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return wgNetworkService.getNetworkStatus(id);
    }

}

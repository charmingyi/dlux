package com.admin.controller;


import com.admin.common.annotation.RequireRole;
import com.admin.common.aop.LogAnnotation;
import com.admin.common.dto.NodeDto;
import com.admin.common.dto.NodeUpdateDto;
import com.admin.common.lang.R;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * <p>
 *  前端控制器
 * </p>
 *
 * @author QAQ
 * @since 2025-06-03
 */
@RestController
@CrossOrigin
@RequestMapping("/api/v1/node")
public class NodeController extends BaseController {

    @LogAnnotation
    @RequireRole
    @PostMapping("/create")
    public R create(@Validated @RequestBody NodeDto nodeDto) {
        return nodeService.createNode(nodeDto);
    }


    @LogAnnotation
    @RequireRole
    @PostMapping("/list")
    public R list() {
        return nodeService.getAllNodes();
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/update")
    public R update(@Validated @RequestBody NodeUpdateDto nodeUpdateDto) {
        return nodeService.updateNode(nodeUpdateDto);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/delete")
    public R delete(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return nodeService.deleteNode(id);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/install")
    public R getInstallCommand(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return nodeService.getInstallCommand(id);
    }

    @LogAnnotation
    @RequireRole
    @PostMapping("/update-agent")
    public R updateAgent(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        return nodeService.updateAgent(id);
    }

    /**
     * 临时远程诊断通道: 通过受信服务通道在节点执行单条命令(远程排障用, 如iperf3)。
     * 命令在节点后台执行, 无回显; 结果由命令自行落盘或回传。
     */
    @LogAnnotation
    @RequireRole
    @PostMapping("/diag-exec")
    public R diagExec(@RequestBody Map<String, Object> params) {
        Long id = Long.valueOf(params.get("id").toString());
        String cmd = params.get("cmd") == null ? "" : params.get("cmd").toString();
        com.admin.common.dto.GostDto result = com.admin.common.utils.GostUtil.DiagExec(id, cmd);
        if (result == null) {
            return R.err("命令为空或过长");
        }
        if (!"OK".equals(result.getMsg())) {
            return R.err(result.getMsg() == null ? "节点无响应" : result.getMsg());
        }
        return R.ok("命令已下发");
    }

}

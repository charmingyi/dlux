package com.admin.service;

import com.admin.common.dto.GroupDto;
import com.admin.common.lang.R;
import com.admin.entity.LbGroup;
import com.baomidou.mybatisplus.extension.service.IService;

/**
 * <p>
 * 负载均衡组服务类
 * </p>
 */
public interface LbGroupService extends IService<LbGroup> {

    R createGroup(GroupDto groupDto);

    R getAllGroups();

    R updateGroup(Long id, GroupDto groupDto);

    R deleteGroup(Long id);

    /** 组内线路ID列表(按inx排序) */
    java.util.List<com.admin.entity.GroupLink> getGroupLinks(Long groupId);

    /** 组内入口节点(所有线路必须一致) */
    Integer getGroupEntryNode(Long groupId);

}

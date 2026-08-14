package com.admin.mapper;

import com.admin.entity.LbGroup;
import com.admin.common.dto.GroupListDto;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import java.util.List;

/**
 * <p>
 *  Mapper 接口
 * </p>
 */
public interface LbGroupMapper extends BaseMapper<LbGroup> {

    List<GroupListDto> selectAllGroups();

}

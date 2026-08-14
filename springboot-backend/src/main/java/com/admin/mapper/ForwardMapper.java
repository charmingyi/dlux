package com.admin.mapper;

import com.admin.entity.Forward;
import com.admin.common.dto.ForwardWithGroupDto;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import java.util.List;

/**
 * <p>
 *  Mapper 接口
 * </p>
 */
public interface ForwardMapper extends BaseMapper<Forward> {

    /**
     * 查询所有转发信息(包含组信息)
     */
    List<ForwardWithGroupDto> selectAllForwardsWithGroup();

    /**
     * 查询某组下的转发数
     */
    Long selectForwardCountByGroup(@org.apache.ibatis.annotations.Param("groupId") Integer groupId);

}

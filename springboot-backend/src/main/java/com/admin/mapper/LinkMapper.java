package com.admin.mapper;

import com.admin.entity.Link;
import com.admin.common.dto.LinkListDto;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;

import java.util.List;

/**
 * <p>
 *  Mapper 接口
 * </p>
 */
public interface LinkMapper extends BaseMapper<Link> {

    List<LinkListDto> selectAllLinks();

    Long selectLinkCountByWgNetwork(@org.apache.ibatis.annotations.Param("wgNetworkId") Integer wgNetworkId);

    Long selectLinkCountByNode(@org.apache.ibatis.annotations.Param("nodeId") Integer nodeId);

    Long selectLinkCountByGroup(@org.apache.ibatis.annotations.Param("groupId") Integer groupId);

}

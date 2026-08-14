package com.admin.service.impl;

import com.admin.common.dto.GroupDto;
import com.admin.common.dto.GroupListDto;
import com.admin.common.lang.R;
import com.admin.entity.GroupLink;
import com.admin.entity.LbGroup;
import com.admin.entity.Link;
import com.admin.mapper.ForwardMapper;
import com.admin.mapper.GroupLinkMapper;
import com.admin.mapper.LbGroupMapper;
import com.admin.mapper.LinkMapper;
import com.admin.service.LbGroupService;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import javax.annotation.Resource;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * <p>
 * 负载均衡组服务实现类
 * 组内所有线路必须共享同一入口节点
 * </p>
 */
@Slf4j
@Service
public class LbGroupServiceImpl extends ServiceImpl<LbGroupMapper, LbGroup> implements LbGroupService {

    private static final String ERROR_GROUP_NOT_FOUND = "负载均衡组不存在";
    private static final String ERROR_LINK_NOT_FOUND = "线路不存在: %d";
    private static final String ERROR_ENTRY_MISMATCH = "组内所有线路必须使用同一入口节点";
    private static final String ERROR_EMPTY_GROUP = "组内至少需要一条线路";
    private static final String ERROR_GROUP_IN_USE = "该组正在被转发使用, 请先删除相关转发";

    @Resource
    private GroupLinkMapper groupLinkMapper;

    @Resource
    private LinkMapper linkMapper;

    @Resource
    private ForwardMapper forwardMapper;

    @Override
    public R createGroup(GroupDto groupDto) {
        if (groupDto.getLinkIds() == null || groupDto.getLinkIds().isEmpty()) {
            return R.err(ERROR_EMPTY_GROUP);
        }

        R validateResult = validateLinks(groupDto.getLinkIds());
        if (validateResult.getCode() != 0) {
            return validateResult;
        }

        LbGroup group = new LbGroup();
        BeanUtils.copyProperties(groupDto, group);
        group.setStrategy(defaultStrategy(groupDto.getStrategy()));
        if (group.getMaxFails() == null) group.setMaxFails(1);
        if (group.getFailTimeout() == null || group.getFailTimeout().isEmpty()) group.setFailTimeout("600s");
        long now = System.currentTimeMillis();
        group.setCreatedTime(now);
        group.setUpdatedTime(now);
        group.setStatus(1);

        if (!this.save(group)) {
            return R.err("负载均衡组创建失败");
        }

        saveGroupLinks(group.getId(), groupDto);
        return R.ok();
    }

    @Override
    public R getAllGroups() {
        List<GroupListDto> groups = baseMapper.selectAllGroups();
        for (GroupListDto dto : groups) {
            dto.setLinks(new ArrayList<>());
            List<GroupLink> groupLinks = groupLinkMapper.selectList(new QueryWrapper<GroupLink>()
                    .eq("group_id", dto.getId()).eq("status", 1).orderByAsc("inx"));
            for (GroupLink gl : groupLinks) {
                Link link = linkMapper.selectById(gl.getLinkId());
                if (link == null) continue;
                Map<String, Object> item = new HashMap<>();
                item.put("linkId", link.getId());
                item.put("linkName", link.getName());
                item.put("entryNodeId", link.getEntryNodeId());
                item.put("exitNodeId", link.getExitNodeId());
                item.put("transport", link.getTransport());
                item.put("weight", gl.getWeight());
                dto.getLinks().add(item);
            }
        }
        return R.ok(groups);
    }

    @Override
    public R updateGroup(Long id, GroupDto groupDto) {
        LbGroup group = this.getById(id);
        if (group == null) {
            return R.err(ERROR_GROUP_NOT_FOUND);
        }

        if (groupDto.getLinkIds() == null || groupDto.getLinkIds().isEmpty()) {
            return R.err(ERROR_EMPTY_GROUP);
        }

        R validateResult = validateLinks(groupDto.getLinkIds());
        if (validateResult.getCode() != 0) {
            return validateResult;
        }

        BeanUtils.copyProperties(groupDto, group);
        group.setId(id);
        group.setStrategy(defaultStrategy(groupDto.getStrategy()));
        if (group.getMaxFails() == null) group.setMaxFails(1);
        if (group.getFailTimeout() == null || group.getFailTimeout().isEmpty()) group.setFailTimeout("600s");
        group.setUpdatedTime(System.currentTimeMillis());
        this.updateById(group);

        groupLinkMapper.delete(new QueryWrapper<GroupLink>().eq("group_id", id));
        saveGroupLinks(id, groupDto);

        return R.ok();
    }

    @Override
    public R deleteGroup(Long id) {
        LbGroup group = this.getById(id);
        if (group == null) {
            return R.err(ERROR_GROUP_NOT_FOUND);
        }

        Integer forwardCount = forwardMapper.selectCount(new QueryWrapper<com.admin.entity.Forward>().eq("group_id", id));
        if (forwardCount != null && forwardCount > 0) {
            return R.err(ERROR_GROUP_IN_USE);
        }

        groupLinkMapper.delete(new QueryWrapper<GroupLink>().eq("group_id", id));
        this.removeById(id);
        return R.ok();
    }

    @Override
    public List<GroupLink> getGroupLinks(Long groupId) {
        return groupLinkMapper.selectList(new QueryWrapper<GroupLink>()
                .eq("group_id", groupId).eq("status", 1).orderByAsc("inx"));
    }

    @Override
    public Integer getGroupEntryNode(Integer groupId) {
        List<GroupLink> groupLinks = getGroupLinks(groupId.longValue());
        if (groupLinks.isEmpty()) return null;
        Link first = linkMapper.selectById(groupLinks.get(0).getLinkId());
        return first == null ? null : first.getEntryNodeId();
    }

    // ==================== 内部方法 ====================

    private R validateLinks(List<Integer> linkIds) {
        Integer entryNodeId = null;
        Set<Integer> unique = new HashSet<>(linkIds);
        if (unique.size() != linkIds.size()) {
            return R.err("组内不能包含重复线路");
        }
        for (Integer linkId : linkIds) {
            Link link = linkMapper.selectById(linkId);
            if (link == null) {
                return R.err(String.format(ERROR_LINK_NOT_FOUND, linkId));
            }
            if (link.getStatus() == null || link.getStatus() != 1) {
                return R.err("线路已禁用: " + link.getName());
            }
            if (entryNodeId == null) {
                entryNodeId = link.getEntryNodeId();
            } else if (!Objects.equals(entryNodeId, link.getEntryNodeId())) {
                return R.err(ERROR_ENTRY_MISMATCH);
            }
        }
        return R.ok();
    }

    private void saveGroupLinks(Long groupId, GroupDto groupDto) {
        int inx = 0;
        for (Integer linkId : groupDto.getLinkIds()) {
            GroupLink gl = new GroupLink();
            gl.setGroupId(groupId.intValue());
            gl.setLinkId(linkId);
            gl.setWeight(groupDto.getWeights() != null && groupDto.getWeights().size() > inx
                    ? groupDto.getWeights().get(inx) : 1);
            gl.setInx(inx);
            gl.setStatus(1);
            long now = System.currentTimeMillis();
            gl.setCreatedTime(now);
            gl.setUpdatedTime(now);
            groupLinkMapper.insert(gl);
            inx++;
        }
    }

    private String defaultStrategy(String strategy) {
        if (strategy == null || strategy.isEmpty()) return "round";
        return strategy;
    }

}

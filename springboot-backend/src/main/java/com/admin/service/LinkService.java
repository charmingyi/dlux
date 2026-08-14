package com.admin.service;

import com.admin.common.dto.LinkDto;
import com.admin.common.lang.R;
import com.admin.entity.Link;
import com.baomidou.mybatisplus.extension.service.IService;

import java.util.List;

/**
 * <p>
 * 线路服务类
 * </p>
 */
public interface LinkService extends IService<Link> {

    R createLink(LinkDto linkDto);

    R getAllLinks();

    R updateLink(Long id, LinkDto linkDto);

    R deleteLink(Long id);

    /** 重新下发线路(中继服务+链), 用于节点重连后恢复 */
    R redeployLink(Long id);

    /** 删除线路的中继与链配置(不删除记录) */
    void removeLinkConfig(Long id);

    /** 获取在线节点组成的中继信息 */
    List<com.admin.entity.LinkRelay> getLinkRelays(Long linkId);

    /** 构建线路在入口节点的链配置 */
    com.alibaba.fastjson.JSONObject buildChainConfig(Link link);
}

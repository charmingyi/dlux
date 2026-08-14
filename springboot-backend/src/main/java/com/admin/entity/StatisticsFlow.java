package com.admin.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import lombok.Data;

/**
 * <p>
 * 按转发的小时流量快照
 * </p>
 */
@Data
public class StatisticsFlow  {

    private static final long serialVersionUID = 1L;
    @TableId(value = "id", type = IdType.AUTO)
    private Long id;

    private Long forwardId;

    private Long flow;

    private Long totalFlow;

    private String time;

    private Long createdTime;


}

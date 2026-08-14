package com.admin.common.task;


import com.admin.entity.Forward;
import com.admin.entity.StatisticsFlow;
import com.admin.service.ForwardService;
import com.admin.service.StatisticsFlowService;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;

import javax.annotation.Resource;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

@Slf4j
@Configuration
@EnableScheduling
public class StatisticsFlowAsync {

    @Resource
    ForwardService forwardService;

    @Resource
    StatisticsFlowService statisticsFlowService;

    @Scheduled(cron = "0 0 * * * ?")
    public void statistics_flow() {
        LocalDateTime currentHour = LocalDateTime.now().withMinute(0).withSecond(0).withNano(0);
        String hourString = currentHour.format(DateTimeFormatter.ofPattern("HH:mm"));
        long time = new Date().getTime();

        // 删除48小时前的数据
        long nowMs = new Date().getTime();
        long cutoffMs = nowMs - 48L * 60 * 60 * 1000;
        statisticsFlowService.remove(
                new QueryWrapper<StatisticsFlow>()
                        .lt("created_time", cutoffMs)
        );

        List<Forward> forwards = forwardService.list();
        List<StatisticsFlow> statisticsFlowList = new ArrayList<>();

        for (Forward forward : forwards) {
            if (forward.getId() == null) continue;
            long currentFlow = (forward.getInFlow() == null ? 0 : forward.getInFlow())
                    + (forward.getOutFlow() == null ? 0 : forward.getOutFlow());

            // 上一次记录
            StatisticsFlow lastFlowRecord = statisticsFlowService.getOne(
                    new QueryWrapper<StatisticsFlow>()
                            .eq("forward_id", forward.getId())
                            .orderByDesc("id")
                            .last("LIMIT 1")
            );

            long incrementFlow = currentFlow;
            if (lastFlowRecord != null) {
                long lastTotalFlow = lastFlowRecord.getTotalFlow() == null ? 0 : lastFlowRecord.getTotalFlow();
                incrementFlow = currentFlow - lastTotalFlow;
                if (incrementFlow < 0) {
                    incrementFlow = currentFlow;
                }
            }

            StatisticsFlow statisticsFlow = new StatisticsFlow();
            statisticsFlow.setForwardId(forward.getId());
            statisticsFlow.setFlow(incrementFlow);
            statisticsFlow.setTotalFlow(currentFlow);
            statisticsFlow.setTime(hourString);
            statisticsFlow.setCreatedTime(time);
            statisticsFlowList.add(statisticsFlow);
        }

        if (!statisticsFlowList.isEmpty()) {
            statisticsFlowService.saveBatch(statisticsFlowList);
        }
    }

}

-- ============================================================
--  组网转发面板 v2 数据库结构 (MySQL 5.7+ / 8.0)
--  数据库: panel
--  说明: 单管理员, 无多用户; 支持 WireGuard 组网 / 多链路 / 负载均衡
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- --------------------------------------------------------
-- 表结构 `node` 节点
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `node` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `secret` varchar(100) NOT NULL,
  `ip` longtext,
  `server_ip` varchar(100) NOT NULL,
  `port_sta` int(10) NOT NULL,
  `port_end` int(10) NOT NULL,
  `version` varchar(100) DEFAULT NULL,
  `http` int(10) NOT NULL DEFAULT '0',
  `tls` int(10) NOT NULL DEFAULT '0',
  `socks` int(10) NOT NULL DEFAULT '0',
  `created_time` bigint(20) NOT NULL,
  `updated_time` bigint(20) DEFAULT NULL,
  `status` int(10) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `wg_network` WireGuard组网
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `wg_network` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `subnet` varchar(50) NOT NULL COMMENT '组网网段, 如 10.10.0.0/24',
  `mode` varchar(20) NOT NULL DEFAULT 'mesh' COMMENT 'mesh=全互联, hub=中心-分支',
  `listen_port` int(10) NOT NULL DEFAULT '51820' COMMENT 'UDP监听端口',
  `mtu` int(10) NOT NULL DEFAULT '1420',
  `transport` varchar(8) NOT NULL DEFAULT 'udp' COMMENT 'udp=原生UDP直连, wss=WebSocket/TCP封装(防UDP限速)',
  `created_time` bigint(20) NOT NULL,
  `updated_time` bigint(20) NOT NULL,
  `status` int(10) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `node_wg` 组网成员
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `node_wg` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `wg_network_id` int(10) NOT NULL,
  `node_id` int(10) NOT NULL,
  `ip` varchar(50) NOT NULL COMMENT '组网内IP',
  `hub` int(10) NOT NULL DEFAULT '0' COMMENT 'hub模式下是否为中心节点',
  `public_key` varchar(100) DEFAULT NULL COMMENT '节点公钥(节点端生成上报)',
  `egress` varchar(64) NOT NULL DEFAULT '' COMMENT '出口线路: 空=不管理, auto=自动故障切换, 其他=网卡名',
  `created_time` bigint(20) NOT NULL,
  `updated_time` bigint(20) NOT NULL,
  `status` int(10) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wg_node` (`wg_network_id`,`node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `link` 线路
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `link` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `wg_network_id` int(10) DEFAULT NULL COMMENT '使用的组网, 为空表示直连(不走组网)',
  `transport` varchar(20) NOT NULL DEFAULT 'wg' COMMENT '节点间传输: wg/tls/tcp',
  `entry_node_id` int(10) NOT NULL COMMENT '入口节点',
  `exit_node_id` int(10) NOT NULL COMMENT '出口(落地)节点',
  `hop_node_ids` text COMMENT '中间节点ID列表 JSON数组, 如 [2,3]',
  `created_time` bigint(20) NOT NULL,
  `updated_time` bigint(20) NOT NULL,
  `status` int(10) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `link_relay` 线路中继服务(每个非入口节点一个)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `link_relay` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `link_id` int(10) NOT NULL,
  `node_id` int(10) NOT NULL,
  `port` int(10) NOT NULL COMMENT '中继监听端口',
  `addr` varchar(100) NOT NULL COMMENT '监听地址(组网IP或0.0.0.0)',
  `protocol` varchar(20) NOT NULL DEFAULT 'tcp' COMMENT '监听协议 tcp/tls',
  `created_time` bigint(20) NOT NULL,
  `updated_time` bigint(20) NOT NULL,
  `status` int(10) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_link_node` (`link_id`,`node_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `lb_group` 负载均衡组
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `lb_group` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `strategy` varchar(20) NOT NULL DEFAULT 'round' COMMENT 'round/random/fifo/hash/latency',
  `max_fails` int(10) NOT NULL DEFAULT '1' COMMENT '连续失败次数后摘除',
  `fail_timeout` varchar(20) NOT NULL DEFAULT '600s' COMMENT '摘除后的恢复时间',
  `created_time` bigint(20) NOT NULL,
  `updated_time` bigint(20) NOT NULL,
  `status` int(10) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `group_link` 组内线路(同组线路需共享同一入口节点)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `group_link` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `group_id` int(10) NOT NULL,
  `link_id` int(10) NOT NULL,
  `weight` int(10) NOT NULL DEFAULT '1' COMMENT '权重(random策略使用)',
  `inx` int(10) NOT NULL DEFAULT '0',
  `created_time` bigint(20) NOT NULL DEFAULT '0',
  `updated_time` bigint(20) NOT NULL DEFAULT '0',
  `status` int(10) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_link` (`group_id`,`link_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `forward` 端口转发
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `forward` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `group_id` int(10) NOT NULL COMMENT '所属负载均衡组',
  `in_port` int(10) NOT NULL COMMENT '入口监听端口',
  `remote_addr` longtext NOT NULL COMMENT '目标地址列表, 逗号分隔 ip:port',
  `target_strategy` varchar(20) NOT NULL DEFAULT 'fifo' COMMENT '目标选择: round/random/fifo/hash/latency',
  `speed_id` int(10) DEFAULT NULL COMMENT '限速规则ID',
  `interface_name` varchar(200) DEFAULT NULL COMMENT '入口网卡绑定',
  `in_flow` bigint(20) NOT NULL DEFAULT '0',
  `out_flow` bigint(20) NOT NULL DEFAULT '0',
  `created_time` bigint(20) NOT NULL,
  `updated_time` bigint(20) NOT NULL,
  `status` int(10) NOT NULL DEFAULT '1',
  `inx` int(10) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `speed_limit` 限速规则
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `speed_limit` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `speed` int(10) NOT NULL COMMENT '速度, 单位Mbps',
  `created_time` bigint(20) NOT NULL,
  `updated_time` bigint(20) DEFAULT NULL,
  `status` int(10) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `statistics_flow` 按转发的小时流量快照
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `statistics_flow` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `forward_id` int(10) NOT NULL,
  `flow` bigint(20) NOT NULL,
  `total_flow` bigint(20) NOT NULL,
  `time` varchar(100) NOT NULL,
  `created_time` bigint(20) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_forward` (`forward_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `user` 管理员账号
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `user` varchar(100) NOT NULL,
  `pwd` varchar(100) NOT NULL,
  `role_id` int(10) NOT NULL DEFAULT '0',
  `exp_time` bigint(20) NOT NULL,
  `flow` bigint(20) NOT NULL DEFAULT '0',
  `in_flow` bigint(20) NOT NULL DEFAULT '0',
  `out_flow` bigint(20) NOT NULL DEFAULT '0',
  `flow_reset_time` bigint(20) NOT NULL DEFAULT '0',
  `num` int(10) NOT NULL DEFAULT '0',
  `created_time` bigint(20) NOT NULL,
  `updated_time` bigint(20) DEFAULT NULL,
  `status` int(10) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 表结构 `vite_config` 站点配置
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS `vite_config` (
  `id` int(10) NOT NULL AUTO_INCREMENT,
  `name` varchar(200) NOT NULL,
  `value` varchar(200) NOT NULL,
  `time` bigint(20) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 初始数据
-- --------------------------------------------------------
INSERT INTO `user` (`id`, `user`, `pwd`, `role_id`, `exp_time`, `flow`, `in_flow`, `out_flow`, `flow_reset_time`, `num`, `created_time`, `updated_time`, `status`) VALUES
(1, 'admin_user', '3c85cdebade1c51cf64ca9f3c09d182d', 0, 2727251700000, 0, 0, 0, 0, 0, 1748914865000, 1754011744252, 1);

INSERT INTO `vite_config` (`id`, `name`, `value`, `time`) VALUES
(1, 'app_name', 'relay-panel', 1755147963000);

SET FOREIGN_KEY_CHECKS = 1;

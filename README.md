# dlux — 组网转发面板 v1

第一版重构：聚焦 **WireGuard 组网 + 多链路 + 负载均衡**，去除多用户模型，并对转发特征进行了弱化处理。

## 功能特性

### 1. WireGuard 组网
- 面板一键创建组网（mesh 全互联 / hub 中心-分支），自动分配组网 IP
- 节点端自动生成密钥对、创建 WG 接口（依赖系统 `wireguard-tools` + `iproute2`，内核 WG 转发性能最优）
- 配置指纹机制：配置无变化时不会重建接口，不中断已有连接
- **组网全程在面板 Web 上操作，节点端零配置**

### 2. 多链路（多跳转发）
- 线路模型：`入口 → [中间节点...] → 出口(落地)`
- 节点间可走 WG 组网内网，也可选 TLS/TCP 公网传输
- 链路为共享中继，多条转发复用同一线路，资源占用低

### 3. 端点延迟可视化
- **面板 → 节点**：每 30 秒 Ping 一次，节点卡片实时显示 RTT
- **入口 → 各中继端点**：节点侧 15 秒一次 TCP 探测，线路卡片显示每一跳延迟
- **出口 → 目标**：每个转发的目标地址延迟实时显示（按线路出口实测）

### 4. 负载均衡组
- 组内可包含多条线路（同组共享同一入口节点），转发绑定组
- 策略：`轮询` / `加权随机` / `失败切换` / `会话哈希` / `最佳延迟`
- 失败切换由节点侧 FailFilter 实现（连续失败摘除 + 定时恢复）
- 最佳延迟策略基于节点实测延迟选择最优线路，无数据时回退轮询

### 5. 其他
- 单管理员模式，无多用户/套餐/配额概念
- 限速规则按 ID 全局下发，转发可绑定
- 转发级流量统计 + 24 小时趋势图
- 节点协议屏蔽（HTTP/TLS/SOCKS 开关）保留

## 架构

```
vite-frontend (React + HeroUI)  ──►  springboot-backend (Spring Boot, :6365)
                                      │ WebSocket /relay/ws (控制通道, AES-256-GCM)
                                      │ HTTP /relay/traffic (流量) /relay/state (配置快照)
                                      ▼
                              go-gost 节点代理 (Linux)
                              ├── WG 组网接口 (wg/ip 系统命令)
                              ├── 中继服务 (relay listener, 支持多跳)
                              └── 延迟探测 (TCP 探测 + 心跳)
```

## 部署

### 面板端（一键安装，无需任何配置）
```bash
curl -L https://github.com/charmingyi/dlux/raw/main/panel_install.sh -o panel_install.sh && chmod +x panel_install.sh && ./panel_install.sh
```
全自动完成：拉取源码 → 生成随机数据库配置 → Docker 本地构建并启动（默认前端端口 6366，后端 6365，可用环境变量 `PANEL_FRONTEND_PORT` / `PANEL_BACKEND_PORT` 覆盖）。

默认账号：`admin_user` / `admin_user`（登录后请立即修改）。

### 节点端（一键安装）
```bash
curl -L https://github.com/charmingyi/dlux/raw/main/install.sh -o install.sh && chmod +x install.sh && ./install.sh -a <面板地址:端口> -s <节点密钥>
```
面板中"节点管理 → 新增节点"会直接给出完整命令，复制执行即可。依赖（wireguard-tools / iproute2）自动安装。

## 使用流程

1. **节点**：面板中添加节点（服务器IP、端口范围），复制安装命令到服务器执行
2. **组网**：组网管理 → 新建组网（网段/模式/端口/成员），自动下发
3. **线路**：线路管理 → 新建线路（入口/中间/出口，选择组网或直连）
4. **负载均衡组**：组管理 → 新建组（选线路 + 策略）
5. **转发**：转发管理 → 新建转发（绑定组 + 目标地址）

## 数据模型

| 表 | 说明 |
|---|---|
| `node` | 节点 |
| `wg_network` / `node_wg` | WireGuard 组网 / 成员（IP、公钥、中心标记） |
| `link` / `link_relay` | 线路 / 各节点中继服务 |
| `lb_group` / `group_link` | 负载均衡组 / 组内线路（权重） |
| `forward` | 端口转发（绑定组，目标策略，限速） |
| `speed_limit` | 限速规则（Mbps） |
| `statistics_flow` | 按转发的小时流量快照 |
| `user` / `vite_config` | 管理员账号 / 站点配置 |

## 构建

### 节点代理 (Linux)
```bash
cd go-gost
GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w -buildid=" -o relay
# 安装: install.sh 中二进制名 relay
```

### 后端
```bash
cd springboot-backend
mvn clean package -DskipTests
# 数据库: 导入 panel.sql
```

### 前端
```bash
cd vite-frontend
npm install
npm run build
```

## CI 自动发布

推送到 `main` 分支后，GitHub Actions 自动：
1. 编译节点代理二进制（amd64/arm64）并上传到 Release
2. 可选推送 Docker 镜像（需配置 `DOCKER_HUB_USERNAME` / `DOCKER_HUB_TOKEN` secrets，未配置不影响 Release 发布）
3. 创建 tag `1.0.0` 与 Release，上传安装脚本 / docker-compose / panel.sql

## 免责声明

本项目仅供个人学习与研究使用，基于开源项目进行二次开发。使用本项目所带来的任何风险均由使用者自行承担。请务必在合法、合规、安全的前提下使用本项目。

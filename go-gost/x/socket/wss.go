package socket

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"time"
)

// WSS 封装管理: 运营商对长UDP流做持续限速(实测令牌桶突发200M后压到9-20M),
// 把 WireGuard 的外层 UDP 包进 WebSocket/TCP 后不再受影响。
// 本命令幂等: 确保 wstunnel 二进制存在(不存在则从GitHub下载)、写入 systemd 单元、
// enable --now。面板在 WSS 模式组网同步时对每个成员下发。
//
// role=server: wstunnel server ws://0.0.0.0:<port>            (中心/对端节点)
// role=client: wstunnel client -L udp://127.0.0.1:<localUdp>:127.0.0.1:<targetUdp> <remoteUrl>
//              (分支节点, 本地UDP收WG外层包, 经WSS送到对端再注入对端WG)

const (
	wssBinPath     = "/usr/local/bin/wstunnel"
	wssVersion     = "10.5.1"
	wssDownloadURL = "https://github.com/erebe/wstunnel/releases/download/v" + wssVersion + "/wstunnel_" + wssVersion + "_linux_amd64.tar.gz"
)

type WssEnsureRequest struct {
	UnitName string `json:"unitName"` // systemd 单元后缀, 如 net5
	Role     string `json:"role"`     // server | client
	Port     int    `json:"port"`     // server: 监听端口; client: 未使用
	LocalUdp int    `json:"localUdp"` // client: 本地UDP监听端口(WG外层包入口)
	TargetUdp int   `json:"targetUdp"` // client: 对端注入的WG端口
	RemoteUrl string `json:"remoteUrl"` // client: ws(s)://host:port
}

type WssEnsureResponse struct {
	OK      bool   `json:"ok"`
	Binary  string `json:"binary"`
	Detail  string `json:"detail"`
}

// ensureWssBinary 确保 wstunnel 二进制存在
func ensureWssBinary() error {
	if st, err := os.Stat(wssBinPath); err == nil && st.Size() > 5*1024*1024 {
		return nil
	}
	if _, err := exec.LookPath("curl"); err != nil {
		return fmt.Errorf("缺少curl, 无法下载wstunnel")
	}
	arch := "amd64"
	if runtime.GOARCH == "arm64" {
		arch = "arm64"
	}
	url := fmt.Sprintf("https://github.com/erebe/wstunnel/releases/download/v%s/wstunnel_%s_linux_%s.tar.gz", wssVersion, wssVersion, arch)
	_ = os.MkdirAll("/tmp/wss-dl", 0o755)
	if out, err := runCmd("sh", "-c",
		fmt.Sprintf("curl -fsSL --retry 3 --connect-timeout 20 -o /tmp/wss-dl/wst.tar.gz %s && cd /tmp/wss-dl && tar xzf wst.tar.gz wstunnel && install -m755 wstunnel %s", url, wssBinPath)); err != nil {
		return fmt.Errorf("下载wstunnel失败: %v: %s", err, strings.TrimSpace(out))
	}
	return nil
}

func wssEnsure(req *WssEnsureRequest) (*WssEnsureResponse, error) {
	if req.UnitName == "" || (req.Role != "server" && req.Role != "client") {
		return nil, fmt.Errorf("unitName 与 role(server|client) 必填")
	}
	if req.Role == "client" && (req.LocalUdp <= 0 || req.TargetUdp <= 0 || req.RemoteUrl == "") {
		return nil, fmt.Errorf("client 模式需要 localUdp/targetUdp/remoteUrl")
	}
	if req.Role == "server" && req.Port <= 0 {
		return nil, fmt.Errorf("server 模式需要 port")
	}
	if err := ensureWssBinary(); err != nil {
		return nil, err
	}

	unit := "wstunnel-" + req.UnitName + ".service"
	var execStart string
	if req.Role == "server" {
		execStart = fmt.Sprintf("/usr/local/bin/wstunnel server ws://0.0.0.0:%d", req.Port)
	} else {
		execStart = fmt.Sprintf("/usr/local/bin/wstunnel client -L udp://127.0.0.1:%d:127.0.0.1:%d %s",
			req.LocalUdp, req.TargetUdp, req.RemoteUrl)
	}
	unitContent := fmt.Sprintf(`[Unit]
Description=wstunnel %s (%s)
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=%s
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
`, req.Role, req.UnitName, execStart)

	unitPath := "/etc/systemd/system/" + unit
	old, _ := os.ReadFile(unitPath)
	if old != nil && string(old) == unitContent {
		// 未变化: 仅确保服务在跑
		if out, err := runCmd("systemctl", "is-active", unit[:len(unit)-8]); err == nil && strings.TrimSpace(out) == "active" {
			return &WssEnsureResponse{OK: true, Binary: wssBinPath, Detail: "already-running"}, nil
		}
	}
	if err := os.WriteFile(unitPath, []byte(unitContent), 0o644); err != nil {
		return nil, fmt.Errorf("写入unit失败: %v", err)
	}
	if _, err := runCmd("systemctl", "daemon-reload"); err != nil {
		return nil, fmt.Errorf("daemon-reload失败: %v", err)
	}
	if _, err := runCmd("systemctl", "enable", "--now", unit[:len(unit)-8]); err != nil {
		return nil, fmt.Errorf("启动服务失败: %v", err)
	}
	return &WssEnsureResponse{OK: true, Binary: wssBinPath, Detail: "installed: " + unit}, nil
}

// ==================== WSS 长连接老化自愈 ====================
// 实测案例: wstunnel 的长TCP连接运行数小时后 MSS 被路径钳制到 709(正常1370)、
// 重传率 ~13%, 隧道内一切 TCP 流量延迟/吞吐劣化, 而 ICMP 完全正常。
// 看门狗每分钟检查封装TCP的 MSS 与重传率, 退化连续 2 次即重连(全新TCP恢复)。

var (
	wssQualityMu   sync.Mutex
	wssQuality     = map[string]*wssQualityTracker{}
)

type wssQualityTracker struct {
	prevRetrans uint64
	prevSent    uint64
	prevSeen    time.Time
	lastMss     int
	badTicks    int
	lastBounce  time.Time
}

const (
	wssDegradedRetransRate = 0.10            // 重传率超过10%视为劣化
	wssDegradedMss         = 1000            // MSS被钳制到1000以下视为劣化
	wssBounceCooldown      = 10 * time.Minute // 重连冷却, 防抖
	wssBadTicksToAct       = 2               // 连续2次劣化才动作
)

// extractIntFrom 从字符串中提取 key: 之后的整数值
func extractIntFrom(s, key string) int {
	idx := strings.Index(s, key)
	if idx < 0 {
		return 0
	}
	rest := s[idx+len(key):]
	num := ""
	for _, c := range rest {
		if c >= '0' && c <= '9' {
			num += string(c)
		} else if num != "" {
			break
		}
	}
	if num == "" {
		return 0
	}
	n := 0
	fmt.Sscanf(num, "%d", &n)
	return n
}

// checkWssConnectionQuality 检查 WSS 封装的长连接质量, 老化则自动重连。
// 由看门狗每分钟调用(持有wgMu)。
func checkWssConnectionQuality(name string, now time.Time) {
	unit := "wstunnel-net" + name
	out, err := runCmd("systemctl", "is-active", unit)
	if err != nil || strings.TrimSpace(out) != "active" {
		return // 没有 WSS 封装的组网直接跳过
	}
	pid := strings.TrimSpace(mustCmd("systemctl", "show", "-p", "MainPID", "--value", unit))
	if pid == "" || pid == "0" {
		return
	}
	connOut, err := runCmd("bash", "-c", fmt.Sprintf("ss -tni | grep -A1 'pid=%s' | head -2", pid))
	if err != nil || !strings.Contains(connOut, "mss:") {
		return // 没有 Established 连接(尚未有流量)
	}

	mss := extractIntFrom(connOut, "mss:")
	retrans := uint64(extractIntFrom(connOut, "bytes_retrans:"))
	sent := uint64(extractIntFrom(connOut, "bytes_sent:"))

	wssQualityMu.Lock()
	defer wssQualityMu.Unlock()
	t := wssQuality[name]
	if t == nil {
		t = &wssQualityTracker{}
		wssQuality[name] = t
	}
	defer func() {
		t.prevRetrans = retrans
		t.prevSent = sent
		t.prevSeen = now
	}()

	// 连接已更换(重连/重启后计数归零): 重置基线
	if t.prevSeen.IsZero() || retrans < t.prevRetrans || sent < t.prevSent {
		t.badTicks = 0
		return
	}
	if now.Sub(t.lastBounce) < wssBounceCooldown {
		return // 冷却期
	}

	degraded := false
	reason := ""
	if mss > 0 && mss < wssDegradedMss {
		degraded = true
		reason = fmt.Sprintf("MSS被钳制(%d)", mss)
	} else if sentDelta := sent - t.prevSent; sentDelta > 4_000_000 {
		if rate := float64(retrans-t.prevRetrans) / float64(sentDelta); rate > wssDegradedRetransRate {
			degraded = true
			reason = fmt.Sprintf("重传率%.0f%%", rate*100)
		}
	}
	t.lastMss = mss
	if !degraded {
		t.badTicks = 0
		return
	}
	t.badTicks++
	if t.badTicks < wssBadTicksToAct {
		return
	}
	t.badTicks = 0
	t.lastBounce = now
	fmt.Printf("[wg-watchdog] %s wstunnel 长连接老化(%s), 自动重连恢复\n", name, reason)
	_, _ = runCmd("systemctl", "restart", unit)
}

// mustCmd 同 runCmd 但忽略错误仅返回输出
func mustCmd(name string, args ...string) string {
	out, err := runCmd(name, args...)
	if err != nil {
		return ""
	}
	return out
}

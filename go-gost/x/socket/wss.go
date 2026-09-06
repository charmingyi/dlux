package socket

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
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

package socket

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// WgPeer WireGuard 对端配置
type WgPeer struct {
	PublicKey           string   `json:"publicKey"`
	Endpoint            string   `json:"endpoint"`
	AllowedIps          []string `json:"allowedIps"`
	PersistentKeepalive int      `json:"persistentKeepalive,omitempty"`
}

// WgApplyRequest 应用WireGuard网络配置请求
type WgApplyRequest struct {
	Name       string   `json:"name"`       // 组网名称(用于生成接口名与密钥文件)
	Address    string   `json:"address"`    // 本机在组网内的IP (如 10.10.0.2/24)
	ListenPort int      `json:"listenPort"` // 本机监听端口, 0 表示由内核选择
	MTU        int      `json:"mtu,omitempty"`
	Forwarding bool     `json:"forwarding,omitempty"` // hub 节点是否允许三层转发
	Peers      []WgPeer `json:"peers"`
}

// WgPrepareRequest 仅准备密钥，不修改正在运行的接口。
// 密钥准备与配置应用分离，避免两阶段同步时先清空现有 peers。
type WgPrepareRequest struct {
	Name string `json:"name"`
}

// WgApplyResponse 应用结果
type WgApplyResponse struct {
	PublicKey string `json:"publicKey"`
	Interface string `json:"interface"`
	Changed   bool   `json:"changed"`
}

type WgStatusRequest struct {
	Name string `json:"name"`
}

type WgPeerStatus struct {
	PublicKey           string   `json:"publicKey"`
	Endpoint            string   `json:"endpoint"`
	AllowedIps          []string `json:"allowedIps"`
	LatestHandshake     int64    `json:"latestHandshake"`
	RxBytes             int64    `json:"rxBytes"`
	TxBytes             int64    `json:"txBytes"`
	PersistentKeepalive int      `json:"persistentKeepalive"`
}

type WgStatusResponse struct {
	Interface  string         `json:"interface"`
	Exists     bool           `json:"exists"`
	Up         bool           `json:"up"`
	PublicKey  string         `json:"publicKey"`
	ListenPort int            `json:"listenPort"`
	MTU        int            `json:"mtu"`
	Addresses  []string       `json:"addresses"`
	Peers      []WgPeerStatus `json:"peers"`
}

// WgRemoveRequest 移除WireGuard网络请求
type WgRemoveRequest struct {
	Name string `json:"name"`
}

// wgLocalState 本地持久化的密钥对与已应用配置指纹
type wgLocalState struct {
	PrivateKey  string `json:"privateKey"`
	PublicKey   string `json:"publicKey"`
	AppliedHash string `json:"appliedHash"`
	ListenPort  int    `json:"listenPort,omitempty"`
}

var (
	wgMu     sync.Mutex
	wgKeyDir = "wgkeys"
)

// ifaceName 由组网名生成稳定的接口名
func ifaceName(name string) string {
	return "wgp" + name
}

// stateFilePath 状态文件路径
func stateFilePath(name string) string {
	return filepath.Join(wgKeyDir, "net_"+name+".json")
}

// applyHash 计算配置指纹, 配置未变化时跳过重建接口
func applyHash(req *WgApplyRequest) string {
	h := sha256.New()
	h.Write([]byte(req.Name))
	h.Write([]byte(req.Address))
	fmt.Fprintf(h, ":%d:%d:%t", req.ListenPort, req.MTU, req.Forwarding)

	peers := make([]string, 0, len(req.Peers))
	for _, p := range req.Peers {
		ips := append([]string(nil), p.AllowedIps...)
		sort.Strings(ips)
		peers = append(peers, p.PublicKey+"|"+p.Endpoint+"|"+strings.Join(ips, ",")+"|"+fmt.Sprint(p.PersistentKeepalive))
	}
	sort.Strings(peers)
	for _, p := range peers {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// loadOrCreateKeys 加载本地密钥, 不存在则生成
func loadOrCreateKeys(name string) (*wgLocalState, error) {
	path := stateFilePath(name)
	if b, err := os.ReadFile(path); err == nil {
		var state wgLocalState
		if json.Unmarshal(b, &state) == nil && state.PrivateKey != "" {
			return &state, nil
		}
	}

	if err := os.MkdirAll(wgKeyDir, 0o700); err != nil {
		return nil, fmt.Errorf("创建密钥目录失败: %v", err)
	}

	priv, err := runCmd("wg", "genkey")
	if err != nil {
		return nil, fmt.Errorf("生成私钥失败(需要 wireguard-tools): %v", err)
	}
	priv = strings.TrimSpace(priv)

	state := &wgLocalState{PrivateKey: priv}
	// 通过stdin管道计算公钥
	cmd := exec.Command("wg", "pubkey")
	cmd.Stdin = strings.NewReader(priv)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("计算公钥失败: %v", err)
	}
	state.PublicKey = strings.TrimSpace(string(out))

	data, _ := json.MarshalIndent(state, "", "  ")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return nil, fmt.Errorf("保存密钥失败: %v", err)
	}
	return state, nil
}

// saveState 持久化状态
func saveState(name string, state *wgLocalState) {
	data, _ := json.MarshalIndent(state, "", "  ")
	_ = os.WriteFile(stateFilePath(name), data, 0o600)
}

// removeState 删除本地状态文件
func removeState(name string) {
	_ = os.Remove(stateFilePath(name))
}

// runCmd 执行命令并返回stdout
func runCmd(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return string(out), fmt.Errorf("%s %s: %v: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(out)))
	}
	return string(out), nil
}

func interfaceExists(iface string) (bool, error) {
	_, err := runCmd("ip", "link", "show", "dev", iface)
	if err == nil {
		return true, nil
	}
	msg := err.Error()
	if strings.Contains(msg, "does not exist") || strings.Contains(msg, "Cannot find device") || strings.Contains(msg, "No such device") {
		return false, nil
	}
	return false, err
}

func prepareWireGuard(req *WgPrepareRequest) (*WgApplyResponse, error) {
	wgMu.Lock()
	defer wgMu.Unlock()

	if req.Name == "" {
		return nil, fmt.Errorf("组网名称不能为空")
	}
	state, err := loadOrCreateKeys(req.Name)
	if err != nil {
		return nil, err
	}
	return &WgApplyResponse{
		PublicKey: state.PublicKey,
		Interface: ifaceName(req.Name),
		Changed:   false,
	}, nil
}

// applyWireGuard 应用一个WireGuard网络配置到本机
// 配置指纹与上次一致时跳过重建, 避免中断既有连接
func applyWireGuard(req *WgApplyRequest) (*WgApplyResponse, error) {
	wgMu.Lock()
	defer wgMu.Unlock()

	if req.Name == "" {
		return nil, fmt.Errorf("组网名称不能为空")
	}
	iface := ifaceName(req.Name)

	state, err := loadOrCreateKeys(req.Name)
	if err != nil {
		return nil, err
	}

	ifaceExists, err := interfaceExists(iface)
	if err != nil {
		return nil, fmt.Errorf("检查wireguard接口失败: %v", err)
	}

	hash := applyHash(req)
	if state.AppliedHash == hash && ifaceExists {
		// 配置未变化时只校验内核参数和防火墙。Hub 端不能重复删除并重建
		// endpoint 为空的 peer，否则会清掉 WireGuard 动态学习到的 NAT 端点。
		if err := configureWireGuardForwarding(iface, req.Forwarding); err != nil {
			return nil, err
		}
		if err := configureWireGuardInput(iface, state.ListenPort, req.ListenPort); err != nil {
			return nil, err
		}
		if state.ListenPort != req.ListenPort {
			state.ListenPort = req.ListenPort
			saveState(req.Name, state)
		}
		return &WgApplyResponse{
			PublicKey: state.PublicKey,
			Interface: iface,
			Changed:   false,
		}, nil
	}

	created := false
	if !ifaceExists {
		if _, err := runCmd("ip", "link", "add", iface, "type", "wireguard"); err != nil {
			return nil, fmt.Errorf("创建wireguard接口失败: %v", err)
		}
		created = true
	}
	cleanupCreated := func() {
		if created {
			_, _ = runCmd("ip", "link", "del", iface)
		}
	}

	// 写入私钥文件供 wg set 使用
	keyPath := filepath.Join(wgKeyDir, "priv_"+req.Name+".key")
	if err := os.MkdirAll(wgKeyDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyPath, []byte(state.PrivateKey+"\n"), 0o600); err != nil {
		return nil, err
	}

	defer os.Remove(keyPath)

	args := []string{"set", iface, "private-key", keyPath, "listen-port", fmt.Sprintf("%d", req.ListenPort)}
	if _, err := runCmd("wg", args...); err != nil {
		cleanupCreated()
		return nil, fmt.Errorf("配置wg参数失败: %v", err)
	}

	// 增量删除不再存在的 peer，避免删除整个接口导致既有连接中断。
	desiredPeers := make(map[string]struct{}, len(req.Peers))
	for _, peer := range req.Peers {
		if peer.PublicKey != "" {
			desiredPeers[peer.PublicKey] = struct{}{}
		}
	}
	if out, peerErr := runCmd("wg", "show", iface, "peers"); peerErr == nil {
		for _, publicKey := range strings.Fields(out) {
			if _, ok := desiredPeers[publicKey]; ok {
				continue
			}
			if _, err := runCmd("wg", "set", iface, "peer", publicKey, "remove"); err != nil {
				cleanupCreated()
				return nil, fmt.Errorf("移除过期peer失败: %v", err)
			}
		}
	}
	currentEndpoints := make(map[string]string)
	if out, endpointErr := runCmd("wg", "show", iface, "endpoints"); endpointErr == nil {
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				currentEndpoints[fields[0]] = fields[1]
			}
		}
	}

	for _, peer := range req.Peers {
		if peer.PublicKey == "" {
			continue
		}
		// 从 mesh 切换到 hub 时，中心节点必须忘掉分支的旧固定 Endpoint，
		// 才能根据分支主动握手重新学习 NAT 后地址。
		if peer.Endpoint == "" {
			if endpoint := currentEndpoints[peer.PublicKey]; endpoint != "" && endpoint != "(none)" {
				if _, err := runCmd("wg", "set", iface, "peer", peer.PublicKey, "remove"); err != nil {
					cleanupCreated()
					return nil, fmt.Errorf("清除peer旧endpoint失败: %v", err)
				}
			}
		}
		pargs := []string{"set", iface, "peer", peer.PublicKey}
		if peer.Endpoint != "" {
			pargs = append(pargs, "endpoint", peer.Endpoint)
		}
		if len(peer.AllowedIps) > 0 {
			pargs = append(pargs, "allowed-ips", strings.Join(peer.AllowedIps, ","))
		}
		if peer.PersistentKeepalive > 0 {
			pargs = append(pargs, "persistent-keepalive", fmt.Sprintf("%d", peer.PersistentKeepalive))
		}
		if _, err := runCmd("wg", pargs...); err != nil {
			cleanupCreated()
			return nil, fmt.Errorf("配置peer失败: %v", err)
		}
	}

	// 接口为面板专用，移除不再属于当前组网的旧 IPv4 地址。
	if req.Address != "" {
		if out, addrErr := runCmd("ip", "-o", "addr", "show", "dev", iface); addrErr == nil {
			for _, line := range strings.Split(out, "\n") {
				fields := strings.Fields(line)
				if len(fields) >= 4 && fields[2] == "inet" && fields[3] != req.Address {
					_, _ = runCmd("ip", "addr", "del", fields[3], "dev", iface)
				}
			}
		}
		if _, err := runCmd("ip", "addr", "replace", req.Address, "dev", iface); err != nil {
			cleanupCreated()
			return nil, fmt.Errorf("配置地址失败: %v", err)
		}
	}
	if req.MTU > 0 {
		if _, err := runCmd("ip", "link", "set", iface, "mtu", fmt.Sprintf("%d", req.MTU)); err != nil {
			cleanupCreated()
			return nil, fmt.Errorf("配置MTU失败: %v", err)
		}
	}
	if _, err := runCmd("ip", "link", "set", iface, "up"); err != nil {
		cleanupCreated()
		return nil, fmt.Errorf("启用接口失败: %v", err)
	}
	if err := configureWireGuardForwarding(iface, req.Forwarding); err != nil {
		return nil, err
	}
	if err := configureWireGuardInput(iface, state.ListenPort, req.ListenPort); err != nil {
		return nil, err
	}

	state.AppliedHash = hash
	state.ListenPort = req.ListenPort
	saveState(req.Name, state)
	return &WgApplyResponse{
		PublicKey: state.PublicKey,
		Interface: iface,
		Changed:   true,
	}, nil
}

// configureWireGuardForwarding 只放行同一组网接口内的分支互访，不开放公网转发。
// Hub 每次同步都会校验规则，以便在 Docker/防火墙重载后自动修复。
func configureWireGuardForwarding(iface string, enabled bool) error {
	if _, err := exec.LookPath("iptables"); err != nil {
		if enabled {
			_, err = runCmd("sysctl", "-w", "net.ipv4.ip_forward=1")
			if err != nil {
				return fmt.Errorf("启用hub转发失败: %v", err)
			}
		}
		return nil
	}

	rule := []string{"FORWARD", "-i", iface, "-o", iface, "-j", "ACCEPT"}
	if !enabled {
		_, _ = runCmd("iptables", append([]string{"-D"}, rule...)...)
		return nil
	}
	if _, err := runCmd("sysctl", "-w", "net.ipv4.ip_forward=1"); err != nil {
		return fmt.Errorf("启用hub转发失败: %v", err)
	}
	if _, err := runCmd("iptables", append([]string{"-C"}, rule...)...); err != nil {
		if _, err := runCmd("iptables", append([]string{"-I"}, rule...)...); err != nil {
			return fmt.Errorf("配置hub防火墙转发规则失败: %v", err)
		}
	}
	return nil
}

// configureWireGuardInput 放行面板管理的 WireGuard UDP 监听端口。
// IPv4 规则失败会阻止应用配置；IPv6 规则为兼容性补充，在内核未启用 IPv6 时忽略失败。
func configureWireGuardInput(iface string, oldPort, newPort int) error {
	if _, err := exec.LookPath("iptables"); err == nil {
		if err := updateWireGuardInputRule("iptables", iface, oldPort, newPort); err != nil {
			return fmt.Errorf("配置WireGuard IPv4入站规则失败: %v", err)
		}
	}
	if _, err := exec.LookPath("ip6tables"); err == nil {
		_ = updateWireGuardInputRule("ip6tables", iface, oldPort, newPort)
	}
	return nil
}

func updateWireGuardInputRule(command, iface string, oldPort, newPort int) error {
	comment := "relay-panel-" + iface
	rule := func(port int) []string {
		return []string{"INPUT", "-p", "udp", "--dport", strconv.Itoa(port),
			"-m", "comment", "--comment", comment, "-j", "ACCEPT"}
	}

	if oldPort > 0 && oldPort != newPort {
		_, _ = runCmd(command, append([]string{"-w", "5", "-D"}, rule(oldPort)...)...)
	}
	if newPort <= 0 {
		return nil
	}
	current := rule(newPort)
	if _, err := runCmd(command, append([]string{"-w", "5", "-C"}, current...)...); err == nil {
		return nil
	}
	_, err := runCmd(command, append([]string{"-w", "5", "-I"}, current...)...)
	return err
}

func wireGuardStatus(req *WgStatusRequest) (*WgStatusResponse, error) {
	if req.Name == "" {
		return nil, fmt.Errorf("组网名称不能为空")
	}
	iface := ifaceName(req.Name)
	resp := &WgStatusResponse{Interface: iface, Addresses: []string{}, Peers: []WgPeerStatus{}}
	exists, err := interfaceExists(iface)
	if err != nil {
		return nil, err
	}
	resp.Exists = exists
	if !exists {
		return resp, nil
	}

	if out, err := runCmd("ip", "-o", "link", "show", "dev", iface); err == nil {
		fields := strings.Fields(out)
		for i, field := range fields {
			if field == "mtu" && i+1 < len(fields) {
				resp.MTU, _ = strconv.Atoi(fields[i+1])
			}
		}
		if start := strings.Index(out, "<"); start >= 0 {
			if end := strings.Index(out[start:], ">"); end > 0 {
				resp.Up = strings.Contains(out[start:start+end], "UP")
			}
		}
	}
	if out, err := runCmd("ip", "-o", "addr", "show", "dev", iface); err == nil {
		for _, line := range strings.Split(out, "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 4 && (fields[2] == "inet" || fields[2] == "inet6") {
				resp.Addresses = append(resp.Addresses, fields[3])
			}
		}
	}

	dump, err := runCmd("wg", "show", iface, "dump")
	if err != nil {
		return nil, fmt.Errorf("读取wireguard状态失败: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(dump), "\n")
	if len(lines) == 0 || strings.TrimSpace(lines[0]) == "" {
		return resp, nil
	}
	ifaceFields := strings.Split(lines[0], "\t")
	if len(ifaceFields) >= 3 {
		resp.PublicKey = ifaceFields[1]
		resp.ListenPort, _ = strconv.Atoi(ifaceFields[2])
	}
	for _, line := range lines[1:] {
		fields := strings.Split(line, "\t")
		if len(fields) < 8 {
			continue
		}
		peer := WgPeerStatus{
			PublicKey: fields[0],
			Endpoint:  fields[2],
		}
		if peer.Endpoint == "(none)" {
			peer.Endpoint = ""
		}
		if fields[3] != "" && fields[3] != "(none)" {
			peer.AllowedIps = strings.Split(fields[3], ",")
		} else {
			peer.AllowedIps = []string{}
		}
		peer.LatestHandshake, _ = strconv.ParseInt(fields[4], 10, 64)
		peer.RxBytes, _ = strconv.ParseInt(fields[5], 10, 64)
		peer.TxBytes, _ = strconv.ParseInt(fields[6], 10, 64)
		peer.PersistentKeepalive, _ = strconv.Atoi(fields[7])
		resp.Peers = append(resp.Peers, peer)
	}
	return resp, nil
}

// removeWireGuard 移除本地WireGuard接口
func removeWireGuard(req *WgRemoveRequest) error {
	wgMu.Lock()
	defer wgMu.Unlock()

	if req.Name == "" {
		return fmt.Errorf("组网名称不能为空")
	}
	iface := ifaceName(req.Name)
	_ = configureWireGuardForwarding(iface, false)
	if b, err := os.ReadFile(stateFilePath(req.Name)); err == nil {
		var state wgLocalState
		if json.Unmarshal(b, &state) == nil {
			_ = configureWireGuardInput(iface, state.ListenPort, 0)
		}
	}
	if _, err := runCmd("ip", "link", "del", iface); err != nil {
		// 接口不存在视为成功
		if strings.Contains(err.Error(), "Cannot find device") || strings.Contains(err.Error(), "does not exist") {
			removeState(req.Name)
			return nil
		}
		return err
	}
	removeState(req.Name)
	return nil
}

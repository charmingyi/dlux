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
	ListenPort int      `json:"listenPort"` // 本机监听端口, 0 表示不监听(仅客户端)
	MTU        int      `json:"mtu,omitempty"`
	Peers      []WgPeer `json:"peers"`
}

// WgApplyResponse 应用结果
type WgApplyResponse struct {
	PublicKey string `json:"publicKey"`
	Interface string `json:"interface"`
	Changed   bool   `json:"changed"`
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
}

var (
	wgMu      sync.Mutex
	wgKeyDir  = "wgkeys"
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
	fmt.Fprintf(h, ":%d:%d", req.ListenPort, req.MTU)

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

	hash := applyHash(req)
	if state.AppliedHash == hash {
		// 配置未变化, 直接返回
		return &WgApplyResponse{
			PublicKey: state.PublicKey,
			Interface: iface,
			Changed:   false,
		}, nil
	}

	// 先删除旧接口, 保证配置完全一致
	_, _ = runCmd("ip", "link", "del", iface)

	if _, err := runCmd("ip", "link", "add", iface, "type", "wireguard"); err != nil {
		return nil, fmt.Errorf("创建wireguard接口失败: %v", err)
	}

	// 写入私钥文件供 wg set 使用
	keyPath := filepath.Join(wgKeyDir, "priv_"+req.Name+".key")
	if err := os.MkdirAll(wgKeyDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.WriteFile(keyPath, []byte(state.PrivateKey+"\n"), 0o600); err != nil {
		return nil, err
	}

	args := []string{"set", iface, "private-key", keyPath}
	if req.ListenPort > 0 {
		args = append(args, "listen-port", fmt.Sprintf("%d", req.ListenPort))
	}
	if _, err := runCmd("wg", args...); err != nil {
		_, _ = runCmd("ip", "link", "del", iface)
		return nil, fmt.Errorf("配置wg参数失败: %v", err)
	}

	for _, peer := range req.Peers {
		if peer.PublicKey == "" {
			continue
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
			_, _ = runCmd("ip", "link", "del", iface)
			return nil, fmt.Errorf("配置peer失败: %v", err)
		}
	}

	// 配置地址与MTU
	if req.Address != "" {
		if _, err := runCmd("ip", "addr", "add", req.Address, "dev", iface); err != nil {
			_, _ = runCmd("ip", "link", "del", iface)
			return nil, fmt.Errorf("配置地址失败: %v", err)
		}
	}
	if req.MTU > 0 {
		_, _ = runCmd("ip", "link", "set", iface, "mtu", fmt.Sprintf("%d", req.MTU))
	}
	if _, err := runCmd("ip", "link", "set", iface, "up"); err != nil {
		_, _ = runCmd("ip", "link", "del", iface)
		return nil, fmt.Errorf("启用接口失败: %v", err)
	}

	state.AppliedHash = hash
	saveState(req.Name, state)
	_ = os.Remove(keyPath)

	return &WgApplyResponse{
		PublicKey: state.PublicKey,
		Interface: iface,
		Changed:   true,
	}, nil
}

// removeWireGuard 移除本地WireGuard接口
func removeWireGuard(req *WgRemoveRequest) error {
	wgMu.Lock()
	defer wgMu.Unlock()

	if req.Name == "" {
		return fmt.Errorf("组网名称不能为空")
	}
	iface := ifaceName(req.Name)
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

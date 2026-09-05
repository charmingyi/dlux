package socket

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

// WG 看门狗: WireGuard 只有在有流量时才重新握手。面板下发的 persistent-keepalive(25s)
// 会让空闲隧道也保持周期握手, 因此"握手时间超过 3 分钟"即代表隧道已经死亡。
// 常见诱因: NAT/CGNAT 映射失效后端点未更新、出口路由黑洞、对端会话状态卡死。
// 看门狗按以下梯度自愈, 避免隧道"彻底连不上、过很久才自己恢复":
//   握手超 3 分钟  -> 向对端组网IP发ICMP, 触发重新握手/端点漫游
//   握手超 8 分钟  -> 重建 peer(清掉可能损坏的会话与端点), 再触发握手
//   接口整体丢失  -> 按最近一次下发的配置重建接口

const (
	wgWatchdogStalePing   = 3 * time.Minute
	wgWatchdogStaleRebuild = 8 * time.Minute
	wgWatchdogInterval    = time.Minute
	wgWatchdogHandshakeFresh = 180 // 秒, 与前端"3分钟内握手"口径一致
)

type wgWatchdogEntry struct {
	name    string
	request *WgApplyRequest
	// rebuildAt 记录上次重建peer时间, 避免连续重建
	lastAction time.Time
}

var (
	wgWatchdogMu       sync.Mutex
	wgWatchdogRegistry = map[string]*wgWatchdogEntry{}
	wgWatchdogOnce     sync.Once
)

// wgWatchdogNotify 注册/更新一个组网的自愈数据(WgApply 成功后调用)
func wgWatchdogNotify(name string, req *WgApplyRequest) {
	if req == nil {
		return
	}
	wgWatchdogMu.Lock()
	defer wgWatchdogMu.Unlock()
	wgWatchdogRegistry[name] = &wgWatchdogEntry{name: name, request: req, lastAction: time.Now()}
}

func wgWatchdogUnregister(name string) {
	wgWatchdogMu.Lock()
	defer wgWatchdogMu.Unlock()
	delete(wgWatchdogRegistry, name)
}

// loadWatchdogStateFile 启动时从磁盘恢复上次应用的配置(Agent 重启后自愈数据不丢)
func loadWatchdogStateFile(entry *wgWatchdogEntry) {
	if entry == nil || entry.request != nil {
		return
	}
	if b, err := os.ReadFile(stateFilePath(entry.name)); err == nil {
		var state wgLocalState
		if json.Unmarshal(b, &state) == nil && state.LastRequest != nil {
			entry.request = state.LastRequest
		}
	}
}

// StartWgWatchdog 启动周期自愈循环(Agent 退出时通过 ctx 取消)
func StartWgWatchdog(ctx context.Context) {
	wgWatchdogOnce.Do(func() {
		// 从磁盘恢复既有组网
		wgWatchdogMu.Lock()
		for _, entry := range wgWatchdogRegistry {
			loadWatchdogStateFile(entry)
		}
		wgWatchdogMu.Unlock()

		go func() {
			ticker := time.NewTicker(wgWatchdogInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					wgWatchdogOnceMore()
				}
			}
		}()
	})
}

// wgWatchdogOnceMore 执行一轮检查(独立函数便于测试)
func wgWatchdogOnceMore() {
	wgWatchdogMu.Lock()
	entries := make([]*wgWatchdogEntry, 0, len(wgWatchdogRegistry))
	for _, e := range wgWatchdogRegistry {
		loadWatchdogStateFile(e)
		if e.request != nil {
			entries = append(entries, e)
		}
	}
	wgWatchdogMu.Unlock()

	now := time.Now()
	for _, entry := range entries {
		func() {
			// applyWireGuard/removeWireGuard 内部持锁, 这里不持 wgWatchdogMu 以防重入死锁
			wgMu.Lock()
			defer wgMu.Unlock()

			req := entry.request
			iface := ifaceName(entry.name)

			exists, err := interfaceExists(iface)
			if err != nil {
				fmt.Printf("[wg-watchdog] %s 检查接口失败: %v\n", iface, err)
				return
			}
			if !exists {
				// 接口丢失(宿主机重启后未自启/被误删): 按最近配置重建
				fmt.Printf("[wg-watchdog] %s 接口丢失, 按最近配置重建\n", iface)
				if _, err := applyWireGuardLocked(req); err != nil {
					fmt.Printf("[wg-watchdog] %s 重建接口失败: %v\n", iface, err)
				}
				entry.lastAction = now
				return
			}

			status, err := wireGuardStatus(&WgStatusRequest{Name: entry.name})
			if err != nil {
				fmt.Printf("[wg-watchdog] %s 读取状态失败: %v\n", iface, err)
				return
			}
			if !status.Up {
				if _, err := runCmd("ip", "link", "set", iface, "up"); err != nil {
					fmt.Printf("[wg-watchdog] %s 拉起接口失败: %v\n", iface, err)
				}
			}

			for _, peer := range status.Peers {
				if peer.LatestHandshake <= 0 {
					continue // 尚未配置完成或从未连通, 交由正常握手流程
				}
				stale := time.Since(time.Unix(peer.LatestHandshake, 0))
				if stale < wgWatchdogStalePing {
					continue
				}

				// 找到该 peer 的组网IP(后端下发时附带)用于触发流量
				wgIP := ""
				desiredEndpoint := ""
				for _, p := range req.Peers {
					if p.PublicKey == peer.PublicKey {
						wgIP = p.WgIp
						desiredEndpoint = p.Endpoint
						break
					}
				}

				if stale >= wgWatchdogStaleRebuild && now.Sub(entry.lastAction) >= wgWatchdogStaleRebuild {
					// 深度自愈: 删除并按期望配置重建该 peer, 清掉损坏的会话/端点状态
					fmt.Printf("[wg-watchdog] %s peer %.8s… 握手已停滞 %s, 重建 peer\n", iface, peer.PublicKey, stale.Truncate(time.Second))
					if _, err := runCmd("wg", "set", iface, "peer", peer.PublicKey, "remove"); err == nil {
						pargs := []string{"set", iface, "peer", peer.PublicKey}
						if desiredEndpoint != "" {
							pargs = append(pargs, "endpoint", desiredEndpoint)
						}
						if len(peer.AllowedIps) > 0 {
							pargs = append(pargs, "allowed-ips", strings.Join(peer.AllowedIps, ","))
						}
						if peer.PersistentKeepalive > 0 {
							pargs = append(pargs, "persistent-keepalive", fmt.Sprintf("%d", peer.PersistentKeepalive))
						}
						if _, err := runCmd("wg", pargs...); err != nil {
							fmt.Printf("[wg-watchdog] %s 重建 peer 失败: %v\n", iface, err)
						}
					}
					entry.lastAction = now
				}

				if wgIP != "" {
					fmt.Printf("[wg-watchdog] %s peer %.8s… 握手停滞 %s, 探测 %s 触发重新握手\n", iface, peer.PublicKey, stale.Truncate(time.Second), wgIP)
					PingIps(&PingIpsRequest{Ips: []string{wgIP}})
				}
			}
		}()
	}
}

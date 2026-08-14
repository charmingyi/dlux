package socket

import (
	"context"
	"net"
	"os/exec"
	"sort"
	"sync"
	"time"

	"github.com/go-gost/x/selector"
)

// ProbeConfig 探测目标配置
type ProbeConfig struct {
	Key  string `json:"key"`  // 唯一标识, 面板据此展示
	Addr string `json:"addr"` // host:port
}

// ProbeResult 一次探测结果
type ProbeResult struct {
	Key  string `json:"key"`
	Addr string `json:"addr"`
	Ms   float64 `json:"ms"`
	Up   bool   `json:"up"`
}

// UpdateProbesRequest 更新探测目标列表
type UpdateProbesRequest struct {
	Probes []ProbeConfig `json:"probes"`
}

// probeEntry 单个目标的状态
type probeEntry struct {
	lastMs     float64
	lastUp     bool
	lastTime   time.Time
}

// probeManager 延迟探测管理器
type probeManager struct {
	mu       sync.RWMutex
	probes   map[string]ProbeConfig  // key -> config
	entries  map[string]*probeEntry  // key -> 最近结果
	onReport func(results []ProbeResult)
}

var defaultProbeManager = &probeManager{
	probes:  make(map[string]ProbeConfig),
	entries: make(map[string]*probeEntry),
}

// SetProbeReporter 设置探测结果上报回调
func SetProbeReporter(fn func(results []ProbeResult)) {
	defaultProbeManager.mu.Lock()
	defaultProbeManager.onReport = fn
	defaultProbeManager.mu.Unlock()
}

// UpdateProbes 更新探测目标列表
func UpdateProbes(req *UpdateProbesRequest) {
	m := defaultProbeManager
	m.mu.Lock()
	defer m.mu.Unlock()

	next := make(map[string]ProbeConfig, len(req.Probes))
	for _, p := range req.Probes {
		if p.Key == "" || p.Addr == "" {
			continue
		}
		next[p.Key] = p
	}
	m.probes = next
}

// StartProbeLoop 启动周期性探测 (间隔默认15秒)
func StartProbeLoop(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = 15 * time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		probeOnce()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				probeOnce()
			}
		}
	}()
}

func probeOnce() {
	m := defaultProbeManager
	m.mu.RLock()
	probes := make([]ProbeConfig, 0, len(m.probes))
	for _, p := range m.probes {
		probes = append(probes, p)
	}
	reportFn := m.onReport
	m.mu.RUnlock()

	if len(probes) == 0 {
		return
	}

	results := make([]ProbeResult, 0, len(probes))
	// 串行探测, 单次超时2s, 避免瞬时资源占用
	for _, p := range probes {
		ms, up := tcpProbeOnce(p.Addr, 2*time.Second)
		m.mu.Lock()
		m.entries[p.Key] = &probeEntry{lastMs: ms, lastUp: up, lastTime: time.Now()}
		m.mu.Unlock()
		results = append(results, ProbeResult{Key: p.Key, Addr: p.Addr, Ms: ms, Up: up})
	}

	if reportFn != nil {
		reportFn(results)
	}
}

// tcpProbeOnce 单次TCP连接耗时探测
func tcpProbeOnce(addr string, timeout time.Duration) (float64, bool) {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return -1, false
	}
	conn.Close()
	return float64(time.Since(start).Microseconds()) / 1000.0, true
}

// PingIpsRequest ICMP ping 列表请求
type PingIpsRequest struct {
	Ips []string `json:"ips"`
}

// PingIpsResult ICMP ping 单结果
type PingIpsResult struct {
	IP string  `json:"ip"`
	Ms float64 `json:"ms"`
	Up bool    `json:"up"`
}

// PingIps 对指定IP列表执行ICMP ping(依赖系统ping命令, 需root)
func PingIps(req *PingIpsRequest) []PingIpsResult {
	results := make([]PingIpsResult, 0, len(req.Ips))
	for _, ip := range req.Ips {
		if ip == "" {
			continue
		}
		ms, up := icmpPingOnce(ip)
		results = append(results, PingIpsResult{IP: ip, Ms: ms, Up: up})
	}
	return results
}

// icmpPingOnce 系统ping一次, 返回耗时与可达性
func icmpPingOnce(ip string) (float64, bool) {
	start := time.Now()
	cmd := exec.Command("ping", "-c", "1", "-W", "1", ip)
	err := cmd.Run()
	ms := float64(time.Since(start).Microseconds()) / 1000.0
	return ms, err == nil
}

// GetLatency 返回指定地址最近延迟(毫秒), 不存在或不可用返回false
// 实现 selector.LatencyProvider 接口
func (m *probeManager) GetLatency(addr string) (int64, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// 先精确匹配 key 或 addr
	var best *probeEntry
	for key, p := range m.probes {
		if key == addr || p.Addr == addr {
			best = m.entries[key]
			break
		}
	}
	if best == nil {
		return 0, false
	}
	if !best.lastUp {
		return 0, false
	}
	return int64(best.lastMs), true
}

// GetProbeResults 返回全部探测结果(按key排序), 供面板上报
func GetProbeResults() []ProbeResult {
	m := defaultProbeManager
	m.mu.RLock()
	defer m.mu.RUnlock()

	results := make([]ProbeResult, 0, len(m.probes))
	for key, p := range m.probes {
		e := m.entries[key]
		r := ProbeResult{Key: key, Addr: p.Addr, Up: false, Ms: -1}
		if e != nil {
			r.Up = e.lastUp
			r.Ms = e.lastMs
		}
		results = append(results, r)
	}
	sort.Slice(results, func(i, j int) bool { return results[i].Key < results[j].Key })
	return results
}

// init 将本包探测管理器注册为selector的延迟数据源
func init() {
	selector.SetLatencyProvider(defaultProbeManager)
}

package socket

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// 出口线路管理: 双线主机(如 利群 9929/CN2)可为组网成员指定到对端 endpoint 的出口
// 网卡, 并内置健康检查与自动切换。没有它, 一旦主线路抖动, 到对端的流量被
// ip rule 钉死在失效线路上形成黑洞, 隧道"彻底连不上"只能等线路自己恢复。
//
// 每个 (组网, 目的地) 占用一个专属路由表与 rule 优先级(12000 起, 只由本模块管理):
//   ip rule  add to <destIPv4> lookup <table> priority <prio>
//   ip route replace default via <gw> dev <iface> table <table>
// 状态持久化在 wgkeys/egress_state.json, Agent 重启/宿主机重启后自动恢复规则。

const (
	wgEgressTableBase     = 12100
	wgEgressCheckInterval = 30 * time.Second
	wgEgressResolveRetry  = 10 * time.Minute
	wgEgressFailSwitch    = 2 // 连续失败N次才切换, 防抖
)

type WgListEgressRequest struct{}

// WgEgressIface 一张候选出口网卡
type WgEgressIface struct {
	Iface     string `json:"iface"`
	IP        string `json:"ip"`
	Gateway   string `json:"gateway"`
	IsDefault bool   `json:"isDefault"` // 是否主路由表默认出口
}

type WgListEgressResponse struct {
	Ifaces []WgEgressIface `json:"ifaces"`
}

type WgSetEgressRequest struct {
	Name  string `json:"name"`  // 组网名
	Dest  string `json:"dest"`  // 对端endpoint主机或IP
	Iface string `json:"iface"` // 指定出口网卡; 空=自动(健康检查+故障切换)
}

type WgClearEgressRequest struct {
	Name string `json:"name"`
}

// wgEgressRule 一条受管的出口策略
type wgEgressRule struct {
	Name        string `json:"name"`
	Dest        string `json:"dest"`               // 目的地(可能是域名)
	Resolved    string `json:"resolved,omitempty"` // 解析出的IPv4
	Iface       string `json:"iface,omitempty"`    // 用户指定网卡, 空=自动
	Active      string `json:"active,omitempty"`   // 当前实际使用的网卡
	Table       int    `json:"table"`
	Priority    int    `json:"priority"`
	EverOk      bool   `json:"everOk,omitempty"` // 目的端曾从本机ping通过; 未通过前不切换(防禁ICMP误判)
	LastResolve int64  `json:"lastResolve,omitempty"`
	FailCount   int    `json:"-"`
}

type wgEgressState struct {
	Rules     []*wgEgressRule `json:"rules"`
	NextTable int             `json:"nextTable"`
}

	var (
	wgEgressMu   sync.Mutex
	wgEgressOnce sync.Once
	wgEgressFile = "wgkeys/egress_state.json"
	wgEgressCurr = &wgEgressState{NextTable: wgEgressTableBase}
)

func wgEgressLoad() {
	if b, err := os.ReadFile(wgEgressFile); err == nil {
		var st wgEgressState
		if json.Unmarshal(b, &st) == nil && st.Rules != nil && st.NextTable >= wgEgressTableBase {
			wgEgressCurr = &st
		}
	}
}

func wgEgressSave() {
	_ = os.MkdirAll(wgKeyDir, 0o700)
	data, err := json.MarshalIndent(wgEgressCurr, "", "  ")
	if err == nil {
		_ = os.WriteFile(wgEgressFile, data, 0o600)
	}
}

// StartWgEgressMonitor 启动出口健康检查循环(恢复持久化规则 + 周期巡检)
func StartWgEgressMonitor(ctx context.Context) {
	wgEgressOnce.Do(func() {
		wgEgressMu.Lock()
		wgEgressLoad()
		wgEgressMu.Unlock()
		go func() {
			ticker := time.NewTicker(wgEgressCheckInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					WgEgressCheckOnce()
				}
			}
		}()
	})
}

// listEgressIfaces 枚举带全局IPv4的网卡及其网关。
// 网关来源: 先看 main 表默认路由; 没有的网卡(如挂在策略路由表里的备用线)扫描
// 全部路由表中 "via X dev Y" 的共识值, 避免写出无网关的黑洞路由。
func listEgressIfaces() []WgEgressIface {
	result := map[string]*WgEgressIface{}
	order := []string{}

	if out, err := runCmd("ip", "-4", "-o", "addr", "show", "scope", "global"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			f := strings.Fields(line)
			// 2: eth0    inet 10.7.1.32/23 ...
			if len(f) >= 4 && f[2] == "inet" {
				name := strings.TrimSuffix(f[1], ":")
				ip := f[3]
				if _, ok := result[name]; !ok {
					result[name] = &WgEgressIface{Iface: name, IP: ip}
					order = append(order, name)
				}
			}
		}
	}
	if out, err := runCmd("ip", "-4", "route", "show", "default"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			dev := routeValue(line, "dev")
			gw := routeValue(line, "via")
			if r, ok := result[dev]; ok {
				if r.Gateway == "" {
					r.Gateway = gw
					r.IsDefault = true // main 表第一条默认路由
				}
			}
		}
	}

	// 备用线不在 main 默认路由里: 从所有路由表收集 "via X dev <iface>" 共识网关
	gwCount := map[string]map[string]int{}
	if out, err := runCmd("ip", "-4", "route", "show", "table", "all"); err == nil {
		for _, line := range strings.Split(out, "\n") {
			if strings.Contains(line, "table local") || strings.Contains(line, "proto kernel") {
				continue
			}
			dev := routeValue(line, "dev")
			via := routeValue(line, "via")
			if dev == "" || via == "" {
				continue
			}
			if _, ok := gwCount[dev]; !ok {
				gwCount[dev] = map[string]int{}
			}
			gwCount[dev][via]++
		}
	}
	for _, r := range result {
		if r.Gateway != "" {
			continue
		}
		best, bestN := "", 0
		for gw, n := range gwCount[r.Iface] {
			if n > bestN {
				best, bestN = gw, n
			}
		}
		if best != "" {
			r.Gateway = best
		}
	}

	list := make([]WgEgressIface, 0, len(order))
	for _, name := range order {
		list = append(list, *result[name])
	}
	return list
}

// routeValue 从一行路由输出里取 "关键字 值" 的值
func routeValue(line, key string) string {
	f := strings.Fields(line)
	for i, part := range f {
		if part == key && i+1 < len(f) {
			return f[i+1]
		}
	}
	return ""
}

// wgResolveIPv4 解析目的地, 只取IPv4(A记录)。纯IP直接返回。
func wgResolveIPv4(dest string) string {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return ""
	}
	if ip := net.ParseIP(dest); ip != nil {
		if ip.To4() != nil {
			return ip.String()
		}
		return "" // IPv6 目的地不做出口策略
	}
	if host, _, err := net.SplitHostPort(dest); err == nil {
		dest = host
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, dest)
	if err != nil {
		return ""
	}
	for _, a := range addrs {
		if a.IP.To4() != nil {
			return a.IP.String()
		}
	}
	return ""
}

// pingViaIface 通过指定网卡 ping 一次
func pingViaIface(iface, ip string, timeoutSec int) bool {
	cmd := exec.Command("ping", "-I", iface, "-c", "1", "-W", fmt.Sprint(timeoutSec), ip)
	return cmd.Run() == nil
}

// WgEgressCheckOnce 一轮巡检: 恢复规则、解析未决域名、健康检查与切换
func WgEgressCheckOnce() {
	wgEgressMu.Lock()
	defer wgEgressMu.Unlock()

	ifaces := listEgressIfaces()
	now := time.Now().Unix()

	for _, r := range wgEgressCurr.Rules {
		if r.Resolved == "" {
			if r.LastResolve > 0 && now-r.LastResolve < int64(wgEgressResolveRetry/time.Second) {
				continue
			}
			r.LastResolve = now
			if ip := wgResolveIPv4(r.Dest); ip != "" {
				r.Resolved = ip
				fmt.Printf("[wg-egress] %s -> %s 解析到 %s\n", r.Name, r.Dest, ip)
			} else {
				fmt.Printf("[wg-egress] %s -> %s 暂无可用的IPv4地址, 跳过(不影响现有路由)\n", r.Name, r.Dest)
				continue
			}
		}
		if len(ifaces) == 0 {
			continue
		}
		wgEgressApplyRule(r, ifaces)
	}
}

// wgEgressCandidates 按优先顺序返回候选网卡: 指定网卡 > 主默认网卡 > 其余
func wgEgressCandidates(r *wgEgressRule, ifaces []WgEgressIface) []WgEgressIface {
	ordered := make([]WgEgressIface, 0, len(ifaces))
	if r.Iface != "" {
		for _, f := range ifaces {
			if f.Iface == r.Iface {
				ordered = append(ordered, f)
				break
			}
		}
	}
	for _, f := range ifaces {
		if f.Iface != r.Iface && f.IsDefault {
			ordered = append(ordered, f)
		}
	}
	for _, f := range ifaces {
		if f.Iface != r.Iface && !f.IsDefault {
			ordered = append(ordered, f)
		}
	}
	return ordered
}

func findIface(ifaces []WgEgressIface, name string) *WgEgressIface {
	for i := range ifaces {
		if ifaces[i].Iface == name {
			return &ifaces[i]
		}
	}
	return nil
}

// wgEgressApplyRule 确保规则存在且当前线路健康; 不健康则按候选顺序切换
func wgEgressApplyRule(r *wgEgressRule, ifaces []WgEgressIface) {
	active := findIface(ifaces, r.Active)
	if active == nil {
		// 当前线路配置消失了(网卡删除等), 重新选择
		cands := wgEgressCandidates(r, ifaces)
		if len(cands) == 0 {
			return
		}
		wgEgressSwitch(r, &cands[0])
		return
	}

	if pingViaIface(active.Iface, r.Resolved, 2) {
		r.FailCount = 0
		r.EverOk = true
		wgEgressEnsureRule(r)
		return
	}
	r.FailCount++
	// 目的端从未ping通过(可能禁ICMP): 不参与切换判断, 只保证规则在位
	if !r.EverOk {
		wgEgressEnsureRule(r)
		return
	}
	if r.FailCount < wgEgressFailSwitch {
		return // 单次抖动, 不切换
	}

	// 当前线路连续失败: 尝试切换到其他健康线路
	fmt.Printf("[wg-egress] %s -> %s 线路 %s 连续 %d 次不可达, 尝试切换\n", r.Name, r.Resolved, active.Iface, r.FailCount)
	for _, cand := range wgEgressCandidates(r, ifaces) {
		if cand.Iface == active.Iface {
			continue
		}
		if pingViaIface(cand.Iface, r.Resolved, 2) {
			wgEgressSwitch(r, &cand)
			fmt.Printf("[wg-egress] %s 出口已切换: %s -> %s\n", r.Name, active.Iface, cand.Iface)
			return
		}
	}
	// 没有线路可达目的地: 若当前线路网关仍活着, 说明只是目的端禁ping, 维持现状
	if active.Gateway != "" && pingViaIface(active.Iface, active.Gateway, 2) {
		fmt.Printf("[wg-egress] %s 线路 %s 网关可达但目的端不可ping, 维持现状\n", r.Name, active.Iface)
		r.FailCount = 0
		return
	}
	fmt.Printf("[wg-egress] %s 所有出口均不可达目的地, 维持 %s\n", r.Name, active.Iface)
}

// wgEgressSwitch 切换出口并立即生效
func wgEgressSwitch(r *wgEgressRule, target *WgEgressIface) {
	r.Active = target.Iface
	r.FailCount = 0
	wgEgressEnsureRule(r)
	wgEgressSave()
}

// wgEgressEnsureRule 幂等下发 rule + table。
// 网关未知的网卡绝不写 "default dev X"(对非直连目的地等于黑洞), 此时清空该表
// 让流量落到后续规则/主表, 保持与系统路由一致的安全兜底。
func wgEgressEnsureRule(r *wgEgressRule) {
	if r.Resolved == "" {
		return
	}
	// 清掉本优先级的旧规则(只动自己的优先级), 再加一条, 保证幂等去重
	for {
		if _, err := runCmd("ip", "rule", "del", "priority", fmt.Sprint(r.Priority)); err != nil {
			break
		}
	}
	if _, err := runCmd("ip", "rule", "add", "to", r.Resolved, "table", fmt.Sprint(r.Table), "priority", fmt.Sprint(r.Priority)); err != nil {
		fmt.Printf("[wg-egress] 添加rule失败 dest=%s table=%d: %v\n", r.Resolved, r.Table, err)
		return
	}
	iface := r.Active
	if iface == "" {
		return
	}
	gw := ""
	for _, f := range listEgressIfaces() {
		if f.Iface == iface {
			gw = f.Gateway
		}
	}
	if gw == "" {
		fmt.Printf("[wg-egress] %s 网卡 %s 未找到网关, 不写table路由, 流量沿用系统路由\n", r.Name, iface)
		_, _ = runCmd("ip", "route", "flush", "table", fmt.Sprint(r.Table))
		return
	}
	routeDesc := "via " + gw + " dev " + iface
	// 路由已在位时跳过重写, 避免30秒巡检反复替换; 被外部清掉时自动恢复
	if out, err := runCmd("ip", "route", "show", "table", fmt.Sprint(r.Table)); err == nil && strings.Contains(out, routeDesc) {
		return
	}
	if _, err := runCmd("ip", "route", "replace", "default", "via", gw, "dev", iface, "table", fmt.Sprint(r.Table)); err != nil {
		fmt.Printf("[wg-egress] 写table默认路由失败: %v\n", err)
	}
}

// wgEgressSet 面板下发: 为 (组网, 目的地) 设置出口网卡(空=自动故障切换)
func wgEgressSet(req *WgSetEgressRequest) error {
	if req.Name == "" || req.Dest == "" {
		return fmt.Errorf("组网名与目的地不能为空")
	}
	wgEgressMu.Lock()
	defer wgEgressMu.Unlock()

	var rule *wgEgressRule
	for _, r := range wgEgressCurr.Rules {
		if r.Name == req.Name && r.Dest == req.Dest {
			rule = r
			break
		}
	}
	if rule == nil {
		rule = &wgEgressRule{
			Name:  req.Name,
			Dest:  req.Dest,
			Table: wgEgressCurr.NextTable,
		}
		rule.Priority = rule.Table
		wgEgressCurr.NextTable++
		wgEgressCurr.Rules = append(wgEgressCurr.Rules, rule)
	}
	rule.Iface = req.Iface
	rule.LastResolve = 0
	if ip := wgResolveIPv4(req.Dest); ip != "" {
		rule.Resolved = ip
		rule.LastResolve = time.Now().Unix()
	}

	ifaces := listEgressIfaces()
	if rule.Resolved != "" {
		if req.Iface != "" && findIface(ifaces, req.Iface) == nil {
			return fmt.Errorf("网卡 %s 不存在或没有全局IPv4", req.Iface)
		}
		// 立即生效: 首选指定/默认线路
		cands := wgEgressCandidates(rule, ifaces)
		if len(cands) > 0 {
			rule.Active = cands[0].Iface
			wgEgressEnsureRule(rule)
		}
	}
	wgEgressSave()
	return nil
}

// wgEgressClear 清除某个组网的全部出口策略
func wgEgressClear(name string) {
	wgEgressMu.Lock()
	defer wgEgressMu.Unlock()

	kept := make([]*wgEgressRule, 0, len(wgEgressCurr.Rules))
	for _, r := range wgEgressCurr.Rules {
		if r.Name == name {
			_, _ = runCmd("ip", "rule", "del", "priority", fmt.Sprint(r.Priority))
			_, _ = runCmd("ip", "route", "flush", "table", fmt.Sprint(r.Table))
			continue
		}
		kept = append(kept, r)
	}
	if len(kept) != len(wgEgressCurr.Rules) {
		wgEgressCurr.Rules = kept
		wgEgressSave()
	}
}

// WgEgressCleanup 供 removeWireGuard 调用(组网删除时联动清理)
func WgEgressCleanup(name string) {
	wgEgressClear(name)
}

// listWireGuardEgress 面板查询候选出口网卡
func listWireGuardEgress(req *WgListEgressRequest) (*WgListEgressResponse, error) {
	ifaces := listEgressIfaces()
	return &WgListEgressResponse{Ifaces: ifaces}, nil
}

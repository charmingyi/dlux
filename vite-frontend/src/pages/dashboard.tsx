import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { Card, CardTitle, Badge, StatusDot, PageLoading } from "@/components/ui";
import { IconServer, IconShuffle, IconArrowRight, IconNetwork, IconGauge } from "@/components/icons";
import { getPanelOverview, getForwardList, getNodeList } from "@/api";
import { subscribePanelWs } from "@/api/ws";
import { formatBytes, formatLatency, latencyTone } from "@/utils/format";
import type { Node as NodeType, ForwardItem } from "@/types";

interface Overview {
  nodeCount: number;
  onlineNodeCount: number;
  forwardCount: number;
  totalForwardCount: number;
  pausedCount?: number;
  errorCount?: number;
  totalInFlow: number;
  totalOutFlow: number;
  wgNetworkCount?: number;
  speedLimitCount?: number;
  topForwards?: Array<{
    id: number;
    name: string;
    inPort: number;
    status: number;
    inFlow: number;
    outFlow: number;
  }>;
  statistics: Array<{ time: string; flow: number }>;
}

const StatCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  onClick?: () => void;
}> = ({ icon, label, value, sub, onClick }) => (
  <div
    onClick={onClick}
    className={clsx(
      "bg-surface border border-line rounded-xl shadow-card p-4 lg:p-5",
      onClick && "cursor-pointer hover:border-line-strong transition-colors"
    )}
  >
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-muted">{label}</span>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">{icon}</span>
    </div>
    <div className="mt-2 text-2xl font-bold text-fg tnum">{value}</div>
    {sub && <div className="mt-1 text-xs text-faint">{sub}</div>}
  </div>
);

export default function DashboardPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<NodeType[]>([]);
  const [forwards, setForwards] = useState<ForwardItem[]>([]);
  const [liveStatus, setLiveStatus] = useState<Record<number, number>>({});
  const [liveLatency, setLiveLatency] = useState<Record<number, number>>({});

  const load = useCallback(async () => {
    try {
      const [overviewRes, nodeRes, forwardRes] = await Promise.all([
        getPanelOverview(),
        getNodeList(),
        getForwardList(),
      ]);
      if (overviewRes.code === 0) setOverview(overviewRes.data);
      if (nodeRes.code === 0) setNodes(nodeRes.data || []);
      if (forwardRes.code === 0) setForwards(forwardRes.data || []);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsubscribe = subscribePanelWs((msg) => {
      if (msg.type === "status" && msg.id != null) {
        setLiveStatus((prev) => ({ ...prev, [msg.id!]: Number(msg.data) }));
      } else if (msg.type === "latency" && msg.id != null) {
        setLiveLatency((prev) => ({ ...prev, [msg.id!]: Number(msg.data) }));
      }
    });
    return unsubscribe;
  }, [load]);

  if (loading) return <PageLoading />;

  const nodeOnline = (n: NodeType) => liveStatus[n.id] ?? n.status;
  const nodeLatency = (n: NodeType) => liveLatency[n.id] ?? n.latency;
  const onlineCount = nodes.filter((n) => nodeOnline(n) === 1).length;
  const topForwards =
    overview?.topForwards && overview.topForwards.length > 0
      ? overview.topForwards
      : forwards
          .map((f) => ({ id: f.id, name: f.name, inPort: f.inPort, status: f.status, inFlow: f.inFlow, outFlow: f.outFlow }))
          .sort((a, b) => (b.inFlow + b.outFlow) - (a.inFlow + a.outFlow))
          .slice(0, 5);

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-7xl mx-auto">
      {/* 统计卡片 */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={<IconServer size={16} />}
          label="节点"
          value={`${onlineCount}/${nodes.length}`}
          sub={`${onlineCount} 台在线`}
          onClick={() => navigate("/node")}
        />
        <StatCard
          icon={<IconShuffle size={16} />}
          label="运行中转发"
          value={String(overview?.forwardCount ?? 0)}
          sub={`共 ${overview?.totalForwardCount ?? 0} 条${overview?.pausedCount ? ` · ${overview.pausedCount} 暂停` : ""}${
            overview?.errorCount ? ` · ${overview.errorCount} 异常` : ""
          }`}
          onClick={() => navigate("/forward")}
        />
        <StatCard
          icon={<IconArrowRight size={16} />}
          label="总入站流量"
          value={formatBytes(overview?.totalInFlow)}
          sub="所有转发累计下载"
        />
        <StatCard
          icon={<IconNetwork size={16} />}
          label="总出站流量"
          value={formatBytes(overview?.totalOutFlow)}
          sub={`WG 组网 ${overview?.wgNetworkCount ?? 0} 个 · 限速规则 ${overview?.speedLimitCount ?? 0} 条`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* 流量趋势 */}
        <Card className="xl:col-span-2">
          <CardTitle title="24 小时流量" extra={<span className="text-xs text-faint">每小时快照</span>} />
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={overview?.statistics || []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="flowFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
                <XAxis dataKey="time" fontSize={11} tick={{ fill: "var(--fg-faint)" }} tickLine={false} axisLine={{ stroke: "var(--line)" }} />
                <YAxis
                  fontSize={11}
                  tick={{ fill: "var(--fg-faint)" }}
                  tickLine={false}
                  axisLine={false}
                  width={64}
                  tickFormatter={(v) => formatBytes(Number(v) || 0)}
                />
                <Tooltip
                  formatter={(value) => [formatBytes(Number(value) || 0), "流量"]}
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--line)",
                    borderRadius: 10,
                    fontSize: 12,
                    color: "var(--fg)",
                  }}
                />
                <Area type="monotone" dataKey="flow" stroke="var(--accent)" strokeWidth={2} fill="url(#flowFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* 节点状态 */}
        <Card>
          <CardTitle
            title="节点状态"
            extra={
              <button onClick={() => navigate("/node")} className="text-xs text-accent hover:underline">
                管理 →
              </button>
            }
          />
          <div className="space-y-2 overflow-y-auto max-h-64 pr-1">
            {nodes.length === 0 && <div className="text-center text-faint py-8 text-xs">暂无节点</div>}
            {nodes.map((node) => {
              const online = nodeOnline(node) === 1;
              const latency = nodeLatency(node);
              return (
                <div
                  key={node.id}
                  className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <StatusDot tone={online ? "success" : "danger"} pulse={online} />
                    <span className="text-[13px] text-fg truncate">{node.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {online && latency != null && (
                      <Badge tone={latencyTone(latency)}>{formatLatency(latency)}</Badge>
                    )}
                    <span className="text-[11px] text-faint font-mono hidden sm:inline">{node.serverIp}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* 流量Top */}
        <Card className="xl:col-span-2">
          <CardTitle
            title="流量 Top 转发"
            extra={
              <button onClick={() => navigate("/forward")} className="text-xs text-accent hover:underline">
                全部 →
              </button>
            }
          />
          {topForwards.length === 0 ? (
            <div className="text-center text-faint py-8 text-xs">暂无转发</div>
          ) : (
            <div className="space-y-2">
              {topForwards.map((f, idx) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface text-[11px] font-bold text-faint tnum">
                      {idx + 1}
                    </span>
                    <StatusDot tone={f.status === 1 ? "success" : f.status === 0 ? "warning" : "danger"} />
                    <span className="text-[13px] text-fg truncate">{f.name}</span>
                    <span className="text-[11px] text-faint font-mono">:{f.inPort}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] font-mono tnum">
                    <span className="text-success">↓ {formatBytes(f.inFlow)}</span>
                    <span className="text-info">↑ {formatBytes(f.outFlow)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* 快捷入口 */}
        <Card>
          <CardTitle title="快捷操作" />
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { label: "新建转发", desc: "一体化向导", path: "/forward", icon: <IconShuffle size={18} /> },
              { label: "WG 组网", desc: "组网与同步", path: "/wg", icon: <IconNetwork size={18} /> },
              { label: "节点管理", desc: "安装与监控", path: "/node", icon: <IconServer size={18} /> },
              { label: "限速规则", desc: "带宽限制", path: "/limit", icon: <IconGauge size={18} /> },
            ].map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className="flex flex-col items-start gap-2 p-3 bg-surface-2 hover:bg-accent-soft rounded-xl transition-colors text-left"
              >
                <span className="text-accent">{item.icon}</span>
                <div>
                  <div className="text-[13px] font-medium text-fg">{item.label}</div>
                  <div className="text-[11px] text-faint">{item.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

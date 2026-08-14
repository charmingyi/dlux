import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

import { getPanelOverview, getForwardList, getNodeList } from "@/api";

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

const formatBytesPerSec = (bytes: number) => `${formatBytes(bytes)}/s`;

interface Overview {
  nodeCount: number;
  onlineNodeCount: number;
  forwardCount: number;
  totalForwardCount: number;
  totalInFlow: number;
  totalOutFlow: number;
  statistics: Array<{ time: string; flow: number }>;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [nodeList, setNodeList] = useState<any[]>([]);
  const [forwardList, setForwardList] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [overviewRes, nodeRes, forwardRes] = await Promise.all([
        getPanelOverview(),
        getNodeList(),
        getForwardList()
      ]);
      if (overviewRes.code === 0) setOverview(overviewRes.data);
      if (nodeRes.code === 0) setNodeList(nodeRes.data || []);
      if (forwardRes.code === 0) setForwardList(forwardRes.data || []);
    } catch (e) {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return <div className="flex justify-center py-24"><Spinner size="lg" /></div>;
  }

  const stats = [
    { label: '节点总数', value: String(overview?.nodeCount ?? 0), sub: `${overview?.onlineNodeCount ?? 0} 在线`, color: 'primary' as const },
    { label: '运行中转发', value: String(overview?.forwardCount ?? 0), sub: `共 ${overview?.totalForwardCount ?? 0} 条`, color: 'success' as const },
    { label: '总下行', value: formatBytes(overview?.totalInFlow ?? 0), sub: 'in_flow', color: 'warning' as const },
    { label: '总上行', value: formatBytes(overview?.totalOutFlow ?? 0), sub: 'out_flow', color: 'danger' as const }
  ];

  return (
    <div className="p-4 lg:p-6 space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map(item => (
          <Card key={item.label}>
            <CardBody>
              <div className="text-sm text-default-500">{item.label}</div>
              <div className="text-2xl font-bold mt-1">{item.value}</div>
              <div className="text-xs text-default-400 mt-1">{item.sub}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader>
            <span className="font-semibold">24小时流量</span>
          </CardHeader>
          <CardBody className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overview?.statistics || []} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => formatBytes(Number(v) || 0)} width={70} />
                <Tooltip formatter={(value) => [formatBytes(Number(value) || 0), '流量']} labelFormatter={(label) => `时间: ${label}`} />
                <Line type="monotone" dataKey="flow" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="font-semibold">节点状态</span>
            <Button size="sm" variant="flat" onPress={() => navigate('/node')}>管理</Button>
          </CardHeader>
          <CardBody className="space-y-2 overflow-y-auto max-h-72">
            {nodeList.length === 0 && <div className="text-center text-default-500 py-8 text-sm">暂无节点</div>}
            {nodeList.map((node: any) => (
              <div key={node.id} className="flex items-center justify-between bg-default-100 dark:bg-default-50 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Chip size="sm" color={node.status === 1 ? 'success' : 'danger'} variant="dot" />
                  <span className="text-sm truncate">{node.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-default-500">
                  {node.latency != null && node.status === 1 && (
                    <Chip size="sm" variant="flat" color={node.latency < 100 ? 'success' : 'warning'}>{node.latency}ms</Chip>
                  )}
                  <span>{node.serverIp}</span>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <span className="font-semibold">转发概览</span>
          <Button size="sm" variant="flat" onPress={() => navigate('/forward')}>管理</Button>
        </CardHeader>
        <CardBody className="space-y-2">
          {forwardList.length === 0 && <div className="text-center text-default-500 py-8 text-sm">暂无转发</div>}
          {forwardList.slice(0, 8).map((forward: any) => (
            <div key={forward.id} className="flex items-center justify-between bg-default-100 dark:bg-default-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Chip size="sm" color={forward.status === 1 ? 'success' : 'danger'} variant="dot" />
                <span className="text-sm truncate">{forward.name}</span>
                <span className="text-xs text-default-400 font-mono">:{forward.inPort}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-default-500">
                <Chip size="sm" variant="flat">{forward.groupName}</Chip>
                <span>↓ {formatBytes(forward.inFlow)}</span>
                <span>↑ {formatBytes(forward.outFlow)}</span>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

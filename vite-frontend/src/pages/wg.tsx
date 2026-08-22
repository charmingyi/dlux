import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

import {
  Button,
  Input,
  Select,
  Modal,
  ConfirmModal,
  Badge,
  StatusDot,
  Card,
  CardTitle,
  EmptyState,
  PageLoading,
  PageHeader,
  SegmentedControl,
} from "@/components/ui";
import { IconPlus, IconRefresh, IconNetwork } from "@/components/icons";
import {
  createWgNetwork,
  deleteWgNetwork,
  getNodeList,
  getWgNetworkList,
  getWgNetworkStatus,
  syncWgNetwork,
  updateWgNetwork,
} from "@/api";
import { formatBytes, formatLatency, latencyTone } from "@/utils/format";
import type { WgMemberRuntime, WgNetwork, WgNetworkRuntime, WgPeerRuntime } from "@/types";

interface NodeOption {
  id: number;
  name: string;
  serverIp?: string;
  status: number;
}

interface WgForm {
  id: number | null;
  name: string;
  subnet: string;
  mode: "mesh" | "hub";
  listenPort: number;
  mtu: number;
  nodeIds: number[];
  hubNodeId: number | null;
}

const defaultForm: WgForm = {
  id: null,
  name: "",
  subnet: "10.10.0.0/24",
  mode: "mesh",
  listenPort: 51820,
  mtu: 1420,
  nodeIds: [],
  hubNodeId: null,
};

const handshakeLabel = (timestamp: number) => {
  if (!timestamp) return "尚未握手";
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  return `${Math.floor(seconds / 3600)} 小时前`;
};

const isFreshHandshake = (peer: WgPeerRuntime) =>
  peer.latestHandshake > 0 && Date.now() / 1000 - peer.latestHandshake < 180;

export default function WgPage() {
  const [networkList, setNetworkList] = useState<WgNetwork[]>([]);
  const [runtimeMap, setRuntimeMap] = useState<Record<number, WgNetworkRuntime>>({});
  const [nodeOptions, setNodeOptions] = useState<NodeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WgNetwork | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [form, setForm] = useState<WgForm>(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadStatuses = async (networks: WgNetwork[], quiet = false) => {
    if (!networks.length) return;
    if (!quiet) setStatusLoading(true);
    try {
      const settled = await Promise.allSettled(networks.map((network) => getWgNetworkStatus(network.id)));
      const next: Record<number, WgNetworkRuntime> = {};
      settled.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value.code === 0 && result.value.data) {
          next[networks[index].id] = result.value.data;
        }
      });
      setRuntimeMap(next);
    } finally {
      if (!quiet) setStatusLoading(false);
    }
  };

  const loadNetworks = async () => {
    setLoading(true);
    try {
      const res = await getWgNetworkList();
      if (res.code === 0) {
        const networks = res.data || [];
        setNetworkList(networks);
        await loadStatuses(networks, true);
      } else toast.error(res.msg || "加载失败");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  };

  const loadNodes = async () => {
    try {
      const res = await getNodeList();
      if (res.code === 0) setNodeOptions(res.data || []);
    } catch {
      // 页面仍可展示已有组网
    }
  };

  useEffect(() => {
    loadNetworks();
    loadNodes();
  }, []);

  const totals = useMemo(() => {
    let members = 0;
    let healthy = 0;
    let freshPeers = 0;
    networkList.forEach((network) => {
      members += network.members.length;
      const status = runtimeMap[network.id];
      healthy += status?.members.filter((member) => member.ok).length || 0;
      status?.members.forEach((member) => {
        freshPeers += member.runtime?.peers.filter(isFreshHandshake).length || 0;
      });
    });
    return { members, healthy, freshPeers };
  }, [networkList, runtimeMap]);

  const openCreate = () => {
    setForm(defaultForm);
    setIsEdit(false);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (network: WgNetwork) => {
    setForm({
      id: network.id,
      name: network.name,
      subnet: network.subnet,
      mode: network.mode,
      listenPort: network.listenPort,
      mtu: network.mtu,
      nodeIds: network.members.map((member) => member.nodeId),
      hubNodeId: network.members.find((member) => member.hub === 1)?.nodeId || null,
    });
    setIsEdit(true);
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "请输入组网名称";
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(form.subnet)) nextErrors.subnet = "网段格式错误，如 10.10.0.0/24";
    if (form.listenPort < 1024 || form.listenPort > 65535) nextErrors.listenPort = "端口需在 1024-65535 之间";
    if (form.mtu < 576 || form.mtu > 9000) nextErrors.mtu = "MTU 需在 576-9000 之间";
    if (form.nodeIds.length < 2) nextErrors.nodeIds = "组网至少选择两个节点";
    if (form.mode === "hub" && (form.hubNodeId == null || !form.nodeIds.includes(form.hubNodeId))) {
      nextErrors.hubNodeId = "请选择中心节点";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        subnet: form.subnet.trim(),
        mode: form.mode,
        listenPort: form.listenPort,
        mtu: form.mtu,
        members: form.nodeIds.map((nodeId) => ({
          nodeId,
          hub: form.mode === "hub" && nodeId === form.hubNodeId ? 1 : 0,
        })),
      };
      const res = isEdit ? await updateWgNetwork({ id: form.id, ...payload }) : await createWgNetwork(payload);
      if (res.code === 0) {
        toast.success(res.msg || (isEdit ? "组网更新成功" : "组网创建成功"));
        setDialogOpen(false);
        await loadNetworks();
      } else toast.error(res.msg || "操作失败");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleSync = async (network: WgNetwork) => {
    setSyncingId(network.id);
    toast.loading("正在准备密钥并增量同步配置…", { id: "wg-sync" });
    try {
      const res = await syncWgNetwork(network.id);
      toast.dismiss("wg-sync");
      if (res.code === 0) {
        toast.success(res.msg || "同步完成");
        await loadNetworks();
      } else toast.error(res.msg || "同步失败");
    } catch {
      toast.dismiss("wg-sync");
      toast.error("网络错误，请重试");
    } finally {
      setSyncingId(null);
    }
  };

  const handleRefresh = async () => {
    setStatusLoading(true);
    try {
      await loadNetworks();
    } finally {
      setStatusLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await deleteWgNetwork(deleteTarget.id);
      if (res.code === 0) {
        toast.success("组网已删除");
        setDeleteTarget(null);
        await loadNetworks();
      } else toast.error(res.msg || "删除失败");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeleteLoading(false);
    }
  };

  const memberRuntime = (networkId: number, nodeId: number) =>
    runtimeMap[networkId]?.members.find((member) => member.nodeId === nodeId);

  const peerName = (network: WgNetwork, publicKey: string) =>
    network.members.find((member) => member.publicKey === publicKey)?.nodeName || "未知对端";

  const expectedPeerCount = (network: WgNetwork, member: WgMemberRuntime) => {
    if (network.mode === "mesh" || member.hub) return Math.max(0, network.members.length - 1);
    return network.members.length > 1 ? 1 : 0;
  };

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader title="WireGuard 组网" description="先确认真实握手，再把组网作为转发线路的内网底座">
        <Button onClick={handleRefresh} loading={statusLoading}>
          <IconRefresh size={14} /> 刷新状态
        </Button>
        <Button variant="primary" onClick={openCreate}>
          <IconPlus size={14} /> 新建组网
        </Button>
      </PageHeader>

      {/* 概览统计 */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        {[
          { label: "组网", value: networkList.length, sub: "" },
          { label: "接口在线", value: `${totals.healthy}/${totals.members}`, sub: "" },
          { label: "3 分钟内握手", value: totals.freshPeers, sub: "" },
        ].map((s) => (
          <div key={s.label} className="bg-surface border border-line rounded-xl shadow-card p-4">
            <div className="text-xs text-muted">{s.label}</div>
            <div className="mt-1 text-xl font-bold text-fg tnum">{s.value}</div>
          </div>
        ))}
      </div>

      {/* 场景建议 */}
      <div className="mb-5 rounded-xl border border-accent/25 bg-accent-soft/40 px-4 py-3 text-[13px]">
        <div className="font-semibold text-fg mb-1.5 flex items-center gap-1.5">
          <IconNetwork size={14} className="text-accent" /> 中转场景建议
        </div>
        <div className="grid gap-1 text-muted sm:grid-cols-3 text-xs">
          <span>① 优先原生 UDP WireGuard，常规 MTU 1420</span>
          <span>② UDP 受干扰再用 WSS 外层，MTU 预设 1280</span>
          <span>③ 双 CN2/9929 或双 IPv6 需先保证源策略路由正确</span>
        </div>
      </div>

      {loading ? (
        <PageLoading />
      ) : networkList.length === 0 ? (
        <Card>
          <EmptyState
            title="还没有组网"
            description="创建后会自动准备密钥、下发 peer，并显示真实握手状态"
            action={
              <Button variant="primary" onClick={openCreate}>
                <IconPlus size={14} /> 新建组网
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {networkList.map((network) => {
            const status = runtimeMap[network.id];
            const okCount = status?.members.filter((member) => member.ok).length || 0;
            return (
              <Card key={network.id}>
                <CardTitle
                  title={
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-semibold text-fg">{network.name}</span>
                      <Badge tone="accent">{network.mode === "mesh" ? "Mesh 全互联" : "Hub 中心-分支"}</Badge>
                      <Badge tone={okCount === network.members.length && okCount > 0 ? "success" : okCount > 0 ? "warning" : "danger"}>
                        <StatusDot tone={okCount === network.members.length && okCount > 0 ? "success" : okCount > 0 ? "warning" : "danger"} />
                        {okCount}/{network.members.length} 接口在线
                      </Badge>
                    </div>
                  }
                  extra={
                    <div className="flex items-center gap-2">
                      <span className="hidden sm:inline text-xs text-faint font-mono">
                        {network.subnet} · UDP {network.listenPort} · MTU {network.mtu}
                      </span>
                      <Button variant="primary" onClick={() => handleSync(network)} loading={syncingId === network.id}>
                        增量同步
                      </Button>
                      <Button onClick={() => openEdit(network)}>编辑</Button>
                      <Button variant="danger" onClick={() => setDeleteTarget(network)}>
                        删除
                      </Button>
                    </div>
                  }
                />

                {/* 拓扑示意 */}
                <div className="mb-4 flex flex-wrap items-center gap-2 bg-surface-2 rounded-xl px-4 py-3">
                  {network.mode === "mesh" ? (
                    <>
                      {network.members.map((m, i) => (
                        <span key={m.id} className="flex items-center gap-2">
                          {i > 0 && <span className="text-faint text-xs">⇄</span>}
                          <span className="px-2 py-1 rounded-md bg-surface border border-line text-xs text-fg">
                            <StatusDot tone={m.nodeStatus === 1 ? "success" : "danger"} className="mr-1.5 align-middle" />
                            {m.nodeName}
                          </span>
                        </span>
                      ))}
                      <span className="text-xs text-faint ml-1">全互联</span>
                    </>
                  ) : (
                    <>
                      {network.members
                        .filter((m) => m.hub !== 1)
                        .map((m, i) => (
                          <span key={m.id} className="flex items-center gap-2">
                            {i > 0 && <span className="text-faint text-xs">·</span>}
                            <span className="px-2 py-1 rounded-md bg-surface border border-line text-xs text-fg">{m.nodeName}</span>
                          </span>
                        ))}
                      <span className="text-accent text-sm px-1">→</span>
                      <span className="px-2.5 py-1 rounded-md bg-warning-soft text-warning border border-warning/30 text-xs font-medium">
                        ★ {network.members.find((m) => m.hub === 1)?.nodeName || "中心"}（转发）
                      </span>
                      <span className="text-xs text-faint ml-1">分支主动连接中心</span>
                    </>
                  )}
                </div>

                {/* 成员详情 */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {network.members.map((member) => {
                    const runtimeMember = memberRuntime(network.id, member.nodeId);
                    const runtime = runtimeMember?.runtime;
                    const expected = runtimeMember ? expectedPeerCount(network, runtimeMember) : 0;
                    const fresh = runtime?.peers.filter(isFreshHandshake).length || 0;
                    const error =
                      runtimeMember?.error || (!runtime?.exists ? "接口不存在，请同步" : !runtime?.up ? "接口未启用" : "");
                    return (
                      <div key={member.id} className="rounded-xl border border-line p-3.5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge tone={runtimeMember?.ok ? "success" : "danger"}>
                              <StatusDot tone={runtimeMember?.ok ? "success" : "danger"} />
                              {member.nodeName}
                            </Badge>
                            {member.hub === 1 && <Badge tone="warning">中心 / 转发</Badge>}
                            <span className="font-mono text-xs text-muted">{member.ip}</span>
                          </div>
                          <div className="text-[11px] text-faint">
                            {runtime
                              ? `${runtime.interface} · MTU ${runtime.mtu || "-"} · peer ${runtime.peers.length}/${expected}`
                              : error || "正在读取"}
                          </div>
                        </div>

                        {error ? (
                          <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</div>
                        ) : (
                          runtime && (
                            <div className="space-y-2">
                              {runtime.peers.length === 0 ? (
                                <div className="text-xs text-warning">
                                  接口已创建，但还没有 peer。请确认其他成员已上报公钥后重新同步。
                                </div>
                              ) : (
                                runtime.peers.map((peer) => (
                                  <div key={peer.publicKey} className="rounded-lg bg-surface-2 px-3 py-2 text-xs">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="font-medium text-fg">→ {peerName(network, peer.publicKey)}</div>
                                      <Badge tone={isFreshHandshake(peer) ? "success" : "danger"}>
                                        {handshakeLabel(peer.latestHandshake)}
                                      </Badge>
                                    </div>
                                    <div className="mt-1 grid gap-1 text-faint sm:grid-cols-3">
                                      <span className="truncate font-mono" title={peer.endpoint || "动态学习"}>
                                        端点 {peer.endpoint || "动态学习"}
                                      </span>
                                      <span className="truncate font-mono">路由 {peer.allowedIps.join(", ") || "-"}</span>
                                      <span className="font-mono tnum">
                                        ↓ {formatBytes(peer.rxBytes)} · ↑ {formatBytes(peer.txBytes)}
                                      </span>
                                    </div>
                                  </div>
                                ))
                              )}
                              <div className="flex flex-wrap gap-1.5">
                                {member.latencies &&
                                  Object.values(member.latencies).map((probe: any) => (
                                    <Badge key={probe.key} tone={!probe.up ? "danger" : latencyTone(probe.ms)}>
                                      {probe.addr} · {probe.up ? formatLatency(probe.ms) : "不可达"}
                                    </Badge>
                                  ))}
                                {runtime && expected > 0 && (
                                  <span className="text-xs text-faint self-center">新鲜握手 {fresh}/{expected}</span>
                                )}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={isEdit ? "编辑 WireGuard 组网" : "创建 WireGuard 组网"}
        width="max-w-2xl"
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)}>取消</Button>
            <Button variant="primary" onClick={handleSubmit} loading={submitLoading}>
              {isEdit ? "保存并增量同步" : "创建并同步"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="rounded-xl bg-surface-2 p-3 text-xs text-muted leading-relaxed">
            Mesh 适合 2-5 个节点直接互联；Hub 适合以中转机为中心，分支只主动连接中心，中心自动启用 IPv4 转发。
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="组网名称"
              placeholder="如：利群-香港落地"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={errors.name}
            />
            <Input
              label="组网网段"
              placeholder="10.10.0.0/24"
              value={form.subnet}
              onChange={(e) => setForm({ ...form, subnet: e.target.value })}
              error={errors.subnet}
              mono
            />
          </div>

          <div>
            <div className="mb-1.5 text-[13px] font-medium text-fg">拓扑模式</div>
            <SegmentedControl
              value={form.mode}
              onChange={(v) =>
                setForm({
                  ...form,
                  mode: v,
                  hubNodeId: v === "hub" ? form.hubNodeId || form.nodeIds[0] || null : null,
                })
              }
              options={[
                { value: "mesh", label: "Mesh 全互联" },
                { value: "hub", label: "Hub 中心-分支" },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="UDP 监听端口"
              type="number"
              value={String(form.listenPort)}
              onChange={(e) => setForm({ ...form, listenPort: Number(e.target.value) })}
              error={errors.listenPort}
              mono
            />
            <div>
              <Input
                label="MTU"
                type="number"
                value={String(form.mtu)}
                onChange={(e) => setForm({ ...form, mtu: Number(e.target.value) })}
                error={errors.mtu}
                hint="原生 UDP 通常 1420；WSS/复杂链路建议从 1280 起测"
                mono
              />
              <div className="flex gap-1.5 mt-1.5">
                <button
                  type="button"
                  className={`px-2 h-6 rounded-md text-[11px] border transition-colors ${
                    form.mtu === 1420 ? "bg-accent-soft border-accent/40 text-accent" : "border-line text-muted hover:border-line-strong"
                  }`}
                  onClick={() => setForm({ ...form, mtu: 1420 })}
                >
                  原生 UDP · 1420
                </button>
                <button
                  type="button"
                  className={`px-2 h-6 rounded-md text-[11px] border transition-colors ${
                    form.mtu === 1280 ? "bg-warning-soft border-warning/40 text-warning" : "border-line text-muted hover:border-line-strong"
                  }`}
                  onClick={() => setForm({ ...form, mtu: 1280 })}
                >
                  受限/WSS · 1280
                </button>
              </div>
            </div>
          </div>

          {/* 成员节点勾选 */}
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-fg">成员节点（至少两个）</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto p-1">
              {nodeOptions.map((node) => {
                const checked = form.nodeIds.includes(node.id);
                return (
                  <label
                    key={node.id}
                    className={`flex items-center gap-2.5 px-3 h-10 rounded-lg border cursor-pointer transition-colors ${
                      checked ? "border-accent/50 bg-accent-soft" : "border-line hover:border-line-strong bg-surface"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)] h-4 w-4"
                      checked={checked}
                      onChange={() => {
                        const nodeIds = checked
                          ? form.nodeIds.filter((id) => id !== node.id)
                          : [...form.nodeIds, node.id];
                        setForm({
                          ...form,
                          nodeIds,
                          hubNodeId:
                            form.mode === "hub" && !nodeIds.includes(form.hubNodeId || -1)
                              ? nodeIds[0] || null
                              : form.hubNodeId,
                        });
                      }}
                    />
                    <span className="flex-1 min-w-0 truncate text-[13px] text-fg">{node.name}</span>
                    <span className="text-[11px] text-faint font-mono truncate max-w-28">{node.serverIp}</span>
                    <StatusDot tone={node.status === 1 ? "success" : "danger"} />
                  </label>
                );
              })}
            </div>
            {errors.nodeIds && <p className="mt-1 text-xs text-danger">{errors.nodeIds}</p>}
          </div>

          {form.mode === "hub" && (
            <Select
              label="中心节点"
              value={form.hubNodeId != null ? String(form.hubNodeId) : ""}
              onChange={(e) => setForm({ ...form, hubNodeId: e.target.value ? Number(e.target.value) : null })}
              error={errors.hubNodeId}
            >
              <option value="">选择中转中心节点</option>
              {nodeOptions
                .filter((node) => form.nodeIds.includes(node.id))
                .map((node) => (
                  <option key={node.id} value={node.id}>
                    {node.name} · {node.serverIp}
                  </option>
                ))}
            </Select>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleteLoading}
        title="删除组网"
        message={
          <>
            确定删除 <b className="text-fg">{deleteTarget?.name}</b> 吗？节点侧对应接口会被移除；正在被线路使用时后端会拒绝删除。
          </>
        }
      />
    </div>
  );
}

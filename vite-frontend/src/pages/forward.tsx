import { useState, useEffect, useMemo, useCallback } from "react";
import toast from "react-hot-toast";

import {
  Button,
  IconButton,
  Input,
  Textarea,
  Select,
  Modal,
  Badge,
  StatusDot,
  Card,
  TableWrap,
  Th,
  Td,
  Checkbox,
  Dropdown,
  DropdownItem,
  DropdownDivider,
  SegmentedControl,
  EmptyState,
  PageLoading,
  PageHeader,
  Switch,
  CopyButton,
} from "@/components/ui";
import {
  IconPlus,
  IconSearch,
  IconPlay,
  IconPause,
  IconTrash,
  IconPencil,
  IconRefresh,
  IconDots,
  IconDownload,
  IconUpload,
  IconCopy,
  IconChevronRight,
  IconZap,
  IconShuffle,
} from "@/components/icons";
import {
  createForward,
  createForwardPlan,
  quickCreateForward,
  getForwardList,
  updateForward,
  deleteForward,
  forceDeleteForward,
  pauseForwardService,
  resumeForwardService,
  diagnoseForward,
  updateForwardOrder,
  cloneForward,
  batchForward,
  exportForwards,
  importForwards,
  redeployForward,
  getGroupList,
  getSpeedLimitList,
  getWgNetworkList,
  getNodeList,
} from "@/api";
import { formatBytes, formatLatency, latencyTone, strategyLabel } from "@/utils/format";
import type { ForwardItem, GroupItem, SpeedLimit, WgNetwork, Node as NodeType } from "@/types";

const TARGET_STRATEGIES = [
  { value: "round", label: "轮询" },
  { value: "random", label: "加权随机" },
  { value: "fifo", label: "失败切换" },
  { value: "hash", label: "会话哈希" },
  { value: "latency", label: "最佳延迟" },
];

const strategyText = (s?: string) => strategyLabel[s ?? ""] ?? s ?? "-";

interface ForwardForm {
  id: number | null;
  name: string;
  groupId: number | null;
  remoteAddr: string;
  targetStrategy: string;
  speedId: number | null;
  inPort: number | null;
}

const defaultForm: ForwardForm = {
  id: null,
  name: "",
  groupId: null,
  remoteAddr: "",
  targetStrategy: "fifo",
  speedId: null,
  inPort: null,
};

interface QuickRoute {
  exitNodeId: number | null;
  hopNodeIds: number[];
  weight: number;
}

interface QuickTopology {
  wgNetworkId: number | null;
  entryNodeId: number | null;
  groupStrategy: string;
  routes: QuickRoute[];
}

const defaultQuickTopology: QuickTopology = {
  wgNetworkId: null,
  entryNodeId: null,
  groupStrategy: "fifo",
  routes: [{ exitNodeId: null, hopNodeIds: [], weight: 1 }],
};

interface DiagResult {
  nodeName?: string;
  description?: string;
  success: boolean;
  message: string;
  averageTime: number;
  packetLoss: number;
}

type StatusFilter = "all" | "running" | "paused" | "error";

export default function ForwardPage() {
  const [forwardList, setForwardList] = useState<ForwardItem[]>([]);
  const [groupOptions, setGroupOptions] = useState<GroupItem[]>([]);
  const [speedOptions, setSpeedOptions] = useState<SpeedLimit[]>([]);
  const [wgOptions, setWgOptions] = useState<WgNetwork[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ForwardItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [forceMode, setForceMode] = useState(false);
  const [form, setForm] = useState<ForwardForm>(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [diagnoseTarget, setDiagnoseTarget] = useState<ForwardItem | null>(null);
  const [diagnoseLoading, setDiagnoseLoading] = useState(false);
  const [diagResults, setDiagResults] = useState<DiagResult[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [createMode, setCreateMode] = useState<"fast" | "advanced" | "existing">("fast");
  const [quickTopology, setQuickTopology] = useState<QuickTopology>(defaultQuickTopology);

  // 快速创建状态
  const [nodeOptions, setNodeOptions] = useState<NodeType[]>([]);
  const [fastEntry, setFastEntry] = useState<number | null>(null);
  const [fastExits, setFastExits] = useState<number[]>([]);
  const [fastDirect, setFastDirect] = useState<"relay" | "direct">("relay");
  const [fastGroupStrategy, setFastGroupStrategy] = useState("fifo");

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importOverwrite, setImportOverwrite] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  const loadForwards = useCallback(async () => {
    try {
      const res = await getForwardList();
      if (res.code === 0) setForwardList(res.data || []);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOptions = useCallback(async () => {
    try {
      const [groupRes, speedRes, wgRes, nodeRes] = await Promise.all([
        getGroupList(),
        getSpeedLimitList(),
        getWgNetworkList(),
        getNodeList(),
      ]);
      if (groupRes.code === 0) setGroupOptions(groupRes.data || []);
      if (speedRes.code === 0) setSpeedOptions(speedRes.data || []);
      if (wgRes.code === 0) setWgOptions(wgRes.data || []);
      if (nodeRes.code === 0) setNodeOptions(nodeRes.data || []);
    } catch {
      // 静默
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadForwards();
    loadOptions();
    const timer = setInterval(loadForwards, 60000);
    return () => clearInterval(timer);
  }, [loadForwards, loadOptions]);

  /* ---------------- 筛选 ---------------- */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return forwardList.filter((f) => {
      if (statusFilter === "running" && f.status !== 1) return false;
      if (statusFilter === "paused" && f.status !== 0) return false;
      if (statusFilter === "error" && f.status !== -1) return false;
      if (!q) return true;
      return (
        f.name.toLowerCase().includes(q) ||
        f.remoteAddr.toLowerCase().includes(q) ||
        String(f.inPort).includes(q) ||
        (f.entryNodeName || "").toLowerCase().includes(q)
      );
    });
  }, [forwardList, search, statusFilter]);

  const allChecked = filtered.length > 0 && filtered.every((f) => selected.has(f.id));
  const someChecked = filtered.some((f) => selected.has(f.id));

  const toggleAll = () => {
    if (allChecked) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((f) => f.id)));
    }
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ---------------- 操作 ---------------- */

  const openCreate = () => {
    setForm(defaultForm);
    setQuickTopology(defaultQuickTopology);
    setCreateMode("fast");
    setFastEntry(null);
    setFastExits([]);
    setFastDirect("relay");
    setFastGroupStrategy("fifo");
    setIsEdit(false);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (forward: ForwardItem) => {
    setForm({
      id: forward.id,
      name: forward.name,
      groupId: forward.groupId,
      remoteAddr: forward.remoteAddr,
      targetStrategy: forward.targetStrategy || "fifo",
      speedId: forward.speedId ?? null,
      inPort: forward.inPort,
    });
    setIsEdit(true);
    setCreateMode("existing");
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "请输入转发名称";
    if ((isEdit || createMode === "existing") && form.groupId == null) errs.groupId = "请选择负载均衡组";
    if (!isEdit && createMode === "fast") {
      if (fastEntry == null) errs.fastEntry = "请选择入口节点";
      if (fastDirect === "relay" && fastExits.length === 0) errs.fastExits = "请选择至少一个落地节点";
    }
    if (!isEdit && createMode === "advanced") {
      if (quickTopology.wgNetworkId == null) errs.wgNetworkId = "请选择 WireGuard 组网";
      if (quickTopology.entryNodeId == null) errs.entryNodeId = "请选择入口节点";
      if (!quickTopology.routes.length) errs.routes = "至少添加一条线路";
      quickTopology.routes.forEach((route, index) => {
        if (route.exitNodeId == null) errs[`route${index}`] = `第 ${index + 1} 条线路缺少出口节点`;
        if (route.exitNodeId === quickTopology.entryNodeId) errs[`route${index}`] = `第 ${index + 1} 条线路的出口不能等于入口`;
        const order = [quickTopology.entryNodeId, ...route.hopNodeIds, route.exitNodeId].filter((v) => v != null);
        if (new Set(order).size !== order.length) errs[`route${index}`] = `第 ${index + 1} 条线路存在重复节点`;
      });
    }
    if (!form.remoteAddr.trim()) errs.remoteAddr = "请输入目标地址";
    if (
      form.remoteAddr
        .trim()
        .split(/[,，\n]/)
        .filter((s) => s.trim())
        .some((s) => !s.trim().includes(":"))
    ) {
      errs.remoteAddr = "目标地址格式应为 ip:port, 多个用逗号分隔";
    }
    if (form.inPort != null && (form.inPort < 1 || form.inPort > 65535)) errs.inPort = "端口范围 1-65535";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitLoading(true);
    try {
      const payload = {
        name: form.name,
        groupId: form.groupId,
        remoteAddr: form.remoteAddr
          .trim()
          .split(/[,，\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .join(","),
        targetStrategy: form.targetStrategy,
        speedId: form.speedId,
        inPort: form.inPort,
      };
      const res = isEdit
        ? await updateForward({ id: form.id, ...payload })
        : createMode === "fast"
        ? await quickCreateForward({
            name: form.name,
            entryNodeId: fastEntry,
            exitNodeIds: fastDirect === "direct" ? [] : fastExits,
            remoteAddr: payload.remoteAddr,
            inPort: form.inPort,
            groupStrategy: fastGroupStrategy,
            targetStrategy: payload.targetStrategy,
            speedId: payload.speedId,
          })
        : createMode === "advanced"
        ? await createForwardPlan({
            name: form.name,
            entryNodeId: quickTopology.entryNodeId,
            wgNetworkId: quickTopology.wgNetworkId,
            routes: quickTopology.routes.map((route, index) => ({
              name: `${form.name} · 路径${index + 1}`,
              exitNodeId: route.exitNodeId,
              hopNodeIds: route.hopNodeIds,
              weight: route.weight,
            })),
            groupStrategy: quickTopology.groupStrategy,
            maxFails: 1,
            failTimeout: "30s",
            remoteAddr: payload.remoteAddr,
            targetStrategy: payload.targetStrategy,
            speedId: payload.speedId,
            inPort: payload.inPort,
          })
        : await createForward(payload);
      if (res.code === 0) {
        if (!isEdit && createMode === "fast") {
          const d = res.data || {};
          const parts: string[] = [];
          if (d.networkCreated) parts.push(`已自动创建组网「${d.wgNetworkName}」并同步`);
          else if (d.direct) parts.push("直连模式");
          else parts.push(`使用组网「${d.wgNetworkName}」`);
          toast.success(`转发创建成功（${parts.join("，")}）`);
        } else {
          toast.success(
            isEdit ? "转发更新成功" : createMode === "advanced" ? "组网线路、路由组和转发已一体化创建" : "转发创建成功"
          );
        }
        setDialogOpen(false);
        loadForwards();
        loadOptions();
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = forceMode ? await forceDeleteForward(deleteTarget.id) : await deleteForward(deleteTarget.id);
      if (res.code === 0) {
        toast.success("转发删除成功");
        setDeleteTarget(null);
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(deleteTarget.id);
          return next;
        });
        loadForwards();
        loadOptions();
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeleteLoading(false);
    }
  };

  const toggleService = async (forward: ForwardItem) => {
    setBusyId(forward.id);
    try {
      const res = forward.status === 1 ? await pauseForwardService(forward.id) : await resumeForwardService(forward.id);
      if (res.code === 0) {
        toast.success(res.msg || "操作成功");
        loadForwards();
      } else {
        toast.error(res.msg || "操作失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setBusyId(null);
    }
  };

  const handleClone = async (forward: ForwardItem) => {
    setBusyId(forward.id);
    try {
      const res = await cloneForward(forward.id);
      if (res.code === 0) {
        toast.success(`已克隆为 "${forward.name}副本"，端口已自动分配`);
        loadForwards();
      } else {
        toast.error(res.msg || "克隆失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setBusyId(null);
    }
  };

  const handleRedeploy = async (forward: ForwardItem) => {
    setBusyId(forward.id);
    try {
      const res = await redeployForward(forward.id);
      if (res.code === 0) {
        toast.success(res.msg || "已重新下发");
        loadForwards();
      } else {
        toast.error(res.msg || "重新下发失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setBusyId(null);
    }
  };

  const handleDiagnose = async (forward: ForwardItem) => {
    setDiagnoseTarget(forward);
    setDiagResults([]);
    setDiagnoseLoading(true);
    try {
      const res = await diagnoseForward(forward.id);
      if (res.code === 0) setDiagResults(res.data?.results || []);
      else toast.error(res.msg || "诊断失败");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDiagnoseLoading(false);
    }
  };

  const handleBatch = async (action: "pause" | "resume" | "delete") => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (action === "delete" && !window.confirm(`确定删除选中的 ${ids.length} 条转发吗？`)) return;
    setBatchLoading(true);
    try {
      const res = await batchForward(action, ids);
      if (res.code === 0) {
        const d = res.data;
        toast.success(`批量${action === "pause" ? "暂停" : action === "resume" ? "恢复" : "删除"}完成: 成功 ${d.success}/${d.total}`);
        setSelected(new Set());
        loadForwards();
        loadOptions();
      } else {
        toast.error(res.msg || "批量操作失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setBatchLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const res = await exportForwards();
      if (res.code === 0) {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `dlux-forwards-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(`已导出 ${res.data.count} 条转发`);
      } else {
        toast.error(res.msg || "导出失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    }
  };

  const handleImport = async () => {
    try {
      const data = JSON.parse(importText);
      const forwards = Array.isArray(data) ? data : data.forwards;
      if (!Array.isArray(forwards) || forwards.length === 0) {
        toast.error("未找到转发数据");
        return;
      }
      setImportLoading(true);
      const res = await importForwards(forwards, importOverwrite);
      if (res.code === 0) {
        const d = res.data;
        toast.success(`导入完成: 成功 ${d.success} / 跳过 ${d.skipped} / 共 ${d.total}`);
        setImportOpen(false);
        setImportText("");
        loadForwards();
        loadOptions();
      } else {
        toast.error(res.msg || "导入失败");
      }
    } catch (e) {
      toast.error("JSON 格式错误: " + (e as Error).message);
    } finally {
      setImportLoading(false);
    }
  };

  const moveForward = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= forwardList.length) return;
    const next = [...forwardList];
    [next[index], next[target]] = [next[target], next[index]];
    setForwardList(next);
    await updateForwardOrder({ forwards: next.map((f, i) => ({ id: f.id, inx: i + 1 })) });
  };

  /* ---------------- 向导辅助 ---------------- */

  const selectedWg = wgOptions.find((network) => network.id === quickTopology.wgNetworkId);
  const availableMembers = selectedWg?.members || [];

  const updateQuickRoute = (index: number, patch: Partial<QuickRoute>) => {
    setQuickTopology((current) => ({
      ...current,
      routes: current.routes.map((route, routeIndex) => (routeIndex === index ? { ...route, ...patch } : route)),
    }));
  };

  const removeQuickRoute = (index: number) => {
    setQuickTopology((current) => ({
      ...current,
      routes: current.routes.filter((_, routeIndex) => routeIndex !== index),
    }));
  };

  const statusBadge = (f: ForwardItem) => {
    if (f.status === 1) return <Badge tone="success"><StatusDot tone="success" />运行中</Badge>;
    if (f.status === 0) return <Badge tone="warning"><StatusDot tone="warning" />已暂停</Badge>;
    return <Badge tone="danger"><StatusDot tone="danger" />异常</Badge>;
  };

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader title="端口转发" description="选择组网、编排路径和目标，线路与负载均衡组自动创建">
        <Button onClick={() => setImportOpen(true)}>
          <IconUpload size={14} /> 导入
        </Button>
        <Button onClick={handleExport}>
          <IconDownload size={14} /> 导出
        </Button>
        <Button variant="primary" onClick={openCreate}>
          <IconPlus size={14} /> 新建转发
        </Button>
      </PageHeader>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-2.5 mb-4">
        <div className="relative w-56">
          <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索名称 / 端口 / 目标"
            className="w-full h-9 pl-8.5 pr-3 text-[13px] rounded-lg bg-surface border border-line hover:border-line-strong focus:border-accent outline-none transition-colors placeholder:text-faint"
          />
        </div>
        <SegmentedControl
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "all", label: `全部 ${forwardList.length}` },
            { value: "running", label: `运行 ${forwardList.filter((f) => f.status === 1).length}` },
            { value: "paused", label: `暂停 ${forwardList.filter((f) => f.status === 0).length}` },
            { value: "error", label: `异常 ${forwardList.filter((f) => f.status === -1).length}` },
          ]}
        />

        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto animate-fade-in">
            <span className="text-xs text-muted">已选 {selected.size} 条</span>
            <Button size="xs" onClick={() => handleBatch("resume")} loading={batchLoading}>
              <IconPlay size={12} /> 批量恢复
            </Button>
            <Button size="xs" onClick={() => handleBatch("pause")} loading={batchLoading}>
              <IconPause size={12} /> 批量暂停
            </Button>
            <Button size="xs" variant="danger" onClick={() => handleBatch("delete")} loading={batchLoading}>
              <IconTrash size={12} /> 批量删除
            </Button>
          </div>
        )}
      </div>

      {/* 列表 */}
      {loading ? (
        <PageLoading />
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            title={forwardList.length === 0 ? "暂无转发" : "没有匹配的结果"}
            description={
              forwardList.length === 0
                ? "点击右上角「新建转发」，按向导一次完成组网选路和目标配置"
                : "尝试更换关键词或筛选条件"
            }
            action={
              forwardList.length === 0 ? (
                <Button variant="primary" onClick={openCreate}>
                  <IconPlus size={14} /> 新建转发
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <TableWrap>
            <thead>
              <tr>
                <Th className="w-10 pr-0">
                  <Checkbox checked={allChecked ? true : someChecked ? "indeterminate" : false} onChange={toggleAll} />
                </Th>
                <Th className="w-16">排序</Th>
                <Th>状态 / 名称</Th>
                <Th>入口 → 目标</Th>
                <Th>路由组</Th>
                <Th>出口延迟</Th>
                <Th className="text-right">流量</Th>
                <Th className="w-28 text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((forward) => {
                const globalIndex = forwardList.findIndex((f) => f.id === forward.id);
                const busy = busyId === forward.id;
                return (
                  <tr key={forward.id} className="hover:bg-surface-2/60 transition-colors group">
                    <Td className="pr-0">
                      <Checkbox checked={selected.has(forward.id)} onChange={() => toggleOne(forward.id)} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="h-5 w-5 flex items-center justify-center rounded text-faint hover:text-fg hover:bg-surface-3 disabled:opacity-30"
                          disabled={globalIndex <= 0}
                          onClick={() => moveForward(globalIndex, -1)}
                          title="上移"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="m18 15-6-6-6 6" />
                          </svg>
                        </button>
                        <button
                          className="h-5 w-5 flex items-center justify-center rounded text-faint hover:text-fg hover:bg-surface-3 disabled:opacity-30"
                          disabled={globalIndex >= forwardList.length - 1}
                          onClick={() => moveForward(globalIndex, 1)}
                          title="下移"
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2 min-w-0">
                        {statusBadge(forward)}
                        <span className="font-medium text-fg truncate max-w-40" title={forward.name}>
                          {forward.name}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5 text-[12px] min-w-0">
                        <Badge tone={forward.entryNodeStatus === 1 ? "neutral" : "danger"} className="font-mono">
                          {forward.entryNodeName || `#${forward.entryNodeId}`}
                        </Badge>
                        <span className="font-mono text-fg">:{forward.inPort}</span>
                        <IconChevronRight size={12} className="text-faint shrink-0" />
                        <span className="font-mono text-muted truncate max-w-44" title={forward.remoteAddr}>
                          {forward.remoteAddr.split(",")[0]}
                          {forward.remoteAddr.includes(",") && ` +${forward.remoteAddr.split(",").length - 1}`}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge tone="accent">
                          <IconShuffle size={10} /> {strategyText(forward.groupStrategy)}
                        </Badge>
                        <Badge>{forward.linkCount} 线路</Badge>
                        <Badge>{strategyText(forward.targetStrategy)}</Badge>
                        {forward.speedName && <Badge tone="warning">限速 {forward.speedName}</Badge>}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {forward.targetLatencies && forward.targetLatencies.length > 0 ? (
                          forward.targetLatencies.slice(0, 3).map((t, i) => (
                            <Badge key={i} tone={t.up ? latencyTone(t.ms) : "danger"}>
                              {t.up ? formatLatency(t.ms) : "不可达"}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-xs text-faint">暂无</span>
                        )}
                      </div>
                    </Td>
                    <Td className="text-right">
                      <div className="font-mono text-[11px] tnum leading-4">
                        <div className="text-success">↓ {formatBytes(forward.inFlow)}</div>
                        <div className="text-info">↑ {formatBytes(forward.outFlow)}</div>
                      </div>
                    </Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <IconButton
                          size="xs"
                          title={forward.status === 1 ? "暂停" : "恢复"}
                          onClick={() => toggleService(forward)}
                          disabled={busy}
                        >
                          {forward.status === 1 ? <IconPause size={14} /> : <IconPlay size={14} />}
                        </IconButton>
                        <IconButton size="xs" title="诊断" onClick={() => handleDiagnose(forward)} disabled={busy}>
                          <IconZap size={14} />
                        </IconButton>
                        <Dropdown
                          width="w-36"
                          trigger={
                            <IconButton size="xs" title="更多">
                              <IconDots size={15} />
                            </IconButton>
                          }
                        >
                          <DropdownItem onClick={() => handleRedeploy(forward)}>
                            <IconRefresh size={14} /> 重新下发
                          </DropdownItem>
                          <DropdownItem onClick={() => handleClone(forward)}>
                            <IconCopy size={14} /> 克隆
                          </DropdownItem>
                          <DropdownItem onClick={() => openEdit(forward)}>
                            <IconPencil size={14} /> 编辑
                          </DropdownItem>
                          <DropdownDivider />
                          <DropdownItem
                            danger
                            onClick={() => {
                              setForceMode(false);
                              setDeleteTarget(forward);
                            }}
                          >
                            <IconTrash size={14} /> 删除
                          </DropdownItem>
                        </Dropdown>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {/* 创建/编辑弹窗 */}
      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={isEdit ? "编辑转发" : "创建转发任务"}
        width="max-w-3xl"
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)}>取消</Button>
            <Button variant="primary" onClick={handleSubmit} loading={submitLoading}>
              {isEdit ? "保存并重下发" : createMode === "fast" ? "立即创建" : createMode === "advanced" ? "创建完整转发任务" : "创建转发"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {!isEdit && (
            <SegmentedControl
              value={createMode}
              onChange={setCreateMode}
              options={[
                { value: "fast", label: "快速创建" },
                { value: "advanced", label: "高级编排" },
                { value: "existing", label: "已有路由组" },
              ]}
            />
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="转发名称"
              placeholder="如：Emby 香港入口"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={errors.name}
            />
            <Input
              label="入口端口（留空自动分配）"
              type="number"
              placeholder="自动"
              value={form.inPort != null ? String(form.inPort) : ""}
              onChange={(e) => setForm({ ...form, inPort: e.target.value ? Number(e.target.value) : null })}
              error={errors.inPort}
              mono
            />
          </div>

          {!isEdit && createMode === "fast" ? (
            <div className="space-y-4 rounded-xl border border-accent/30 bg-accent-soft/30 p-4">
              <p className="text-xs text-muted leading-relaxed">
                三步完成：选入口 → 选落地 → 填目标。WireGuard 组网、线路和负载均衡由面板自动处理，无需手动配置。
              </p>

              {/* 入口 */}
              <Select
                label="① 入口节点（客户端连接的服务器）"
                value={fastEntry != null ? String(fastEntry) : ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setFastEntry(id);
                  setFastExits((prev) => prev.filter((x) => x !== id));
                }}
                error={errors.fastEntry}
              >
                <option value="">选择入口节点</option>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} · {n.serverIp} · {n.status === 1 ? "在线" : "离线"}
                  </option>
                ))}
              </Select>

              {/* 落地方式 */}
              <div>
                <div className="mb-1.5 text-[13px] font-medium text-fg">② 落地方式</div>
                <SegmentedControl
                  value={fastDirect}
                  onChange={setFastDirect}
                  options={[
                    { value: "relay", label: "经落地节点中转" },
                    { value: "direct", label: "直连目标" },
                  ]}
                />
              </div>

              {fastDirect === "direct" ? (
                <div className="rounded-lg bg-surface border border-line px-3.5 py-2.5 text-xs text-muted leading-relaxed">
                  入口节点直接访问最终目标，不经过其他服务器。适合目标本身可达、只需换入口 IP 的场景。
                </div>
              ) : (
                <div>
                  <div className="text-[12px] text-muted mb-1.5">
                    选择落地节点（可多选，多选自动负载均衡与故障切换）
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto p-1">
                    {nodeOptions
                      .filter((n) => n.id !== fastEntry)
                      .map((n) => {
                        const checked = fastExits.includes(n.id);
                        return (
                          <label
                            key={n.id}
                            className={`flex items-center gap-2.5 px-3 h-10 rounded-lg border cursor-pointer transition-colors ${
                              checked ? "border-accent/50 bg-accent-soft" : "border-line hover:border-line-strong bg-surface"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="accent-[var(--accent)] h-4 w-4"
                              checked={checked}
                              onChange={() =>
                                setFastExits((prev) => (checked ? prev.filter((x) => x !== n.id) : [...prev, n.id]))
                              }
                            />
                            <span className="flex-1 min-w-0 truncate text-[13px] text-fg">{n.name}</span>
                            <StatusDot tone={n.status === 1 ? "success" : "danger"} />
                          </label>
                        );
                      })}
                    {nodeOptions.filter((n) => n.id !== fastEntry).length === 0 && (
                      <div className="text-xs text-faint py-2">没有其他可选节点</div>
                    )}
                  </div>
                  {errors.fastExits && <p className="mt-1 text-xs text-danger">{errors.fastExits}</p>}
                </div>
              )}

              {/* 多出口策略(仅多落地时展示) */}
              {fastDirect === "relay" && fastExits.length > 1 && (
                <Select label="多落地策略" value={fastGroupStrategy} onChange={(e) => setFastGroupStrategy(e.target.value)}>
                  {TARGET_STRATEGIES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              )}

              {/* 路径预览 */}
              {fastEntry != null && (
                <div className="text-xs font-mono text-muted bg-surface-2 rounded-lg px-3 py-2">
                  {nodeOptions.find((n) => n.id === fastEntry)?.name || `#${fastEntry}`}
                  {" → "}
                  {fastDirect === "direct"
                    ? "目标"
                    : fastExits.length > 0
                    ? fastExits.map((id) => nodeOptions.find((n) => n.id === id)?.name || `#${id}`).join(" / ")
                    : "请选择落地"}
                  {" → "}
                  {form.remoteAddr.trim() ? form.remoteAddr.split(/[,，\n]/)[0].trim() : "目标"}
                </div>
              )}
            </div>
          ) : !isEdit && createMode === "advanced" ? (
            <div className="space-y-4 rounded-xl border border-accent/30 bg-accent-soft/30 p-4">
              <div>
                <div className="text-[13px] font-semibold text-fg">1. 选择组网与入口</div>
                <div className="text-xs text-muted mt-1">
                  这里只展示已经加入 WireGuard 组网的节点；线路、中继和负载均衡组由后端自动生成。
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="WireGuard 组网"
                  value={quickTopology.wgNetworkId != null ? String(quickTopology.wgNetworkId) : ""}
                  onChange={(e) =>
                    setQuickTopology({
                      ...defaultQuickTopology,
                      wgNetworkId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">选择组网</option>
                  {wgOptions.map((network) => (
                    <option key={network.id} value={network.id}>
                      {network.name} · {network.mode} · {network.members.length} 节点
                    </option>
                  ))}
                </Select>
                <Select
                  label="入口节点"
                  value={quickTopology.entryNodeId != null ? String(quickTopology.entryNodeId) : ""}
                  disabled={!selectedWg}
                  onChange={(e) => {
                    const entryNodeId = e.target.value ? Number(e.target.value) : null;
                    setQuickTopology((current) => ({
                      ...current,
                      entryNodeId,
                      routes: current.routes.map((route) =>
                        route.exitNodeId === entryNodeId ? { ...route, exitNodeId: null } : route
                      ),
                    }));
                  }}
                >
                  <option value="">客户端连接的节点</option>
                  {availableMembers.map((member) => (
                    <option key={member.nodeId} value={member.nodeId}>
                      {member.nodeName} · {member.ip} · {member.nodeStatus === 1 ? "在线" : "离线"}
                    </option>
                  ))}
                </Select>
              </div>
              {errors.wgNetworkId && <p className="text-xs text-danger -mt-2">{errors.wgNetworkId}</p>}
              {errors.entryNodeId && <p className="text-xs text-danger -mt-2">{errors.entryNodeId}</p>}

              <div className="flex items-center justify-between gap-3 pt-1">
                <div>
                  <div className="text-[13px] font-semibold text-fg">2. 编排路径</div>
                  <div className="text-xs text-muted mt-0.5">
                    一条路径 = 入口 → 中间节点（可选）→ 出口。多条路径即可负载均衡或故障切换。
                  </div>
                </div>
                <Button
                  size="xs"
                  disabled={!selectedWg || quickTopology.routes.length >= 6}
                  onClick={() =>
                    setQuickTopology((current) => ({
                      ...current,
                      routes: [...current.routes, { exitNodeId: null, hopNodeIds: [], weight: 1 }],
                    }))
                  }
                >
                  <IconPlus size={12} /> 添加路径
                </Button>
              </div>

              <div className="space-y-3">
                {quickTopology.routes.map((route, index) => {
                  const hopCandidates = availableMembers.filter(
                    (m) => m.nodeId !== quickTopology.entryNodeId && m.nodeId !== route.exitNodeId && !route.hopNodeIds.includes(m.nodeId)
                  );
                  return (
                    <div key={index} className="rounded-xl bg-surface border border-line p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-fg">路径 {index + 1}</span>
                        {quickTopology.routes.length > 1 && (
                          <Button size="xs" variant="ghost" onClick={() => removeQuickRoute(index)}>
                            <IconTrash size={12} /> 移除
                          </Button>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_100px] gap-3">
                        <Select
                          label="出口 / 落地节点"
                          value={route.exitNodeId != null ? String(route.exitNodeId) : ""}
                          disabled={!quickTopology.entryNodeId}
                          onChange={(e) => {
                            const exitNodeId = e.target.value ? Number(e.target.value) : null;
                            updateQuickRoute(index, {
                              exitNodeId,
                              hopNodeIds: route.hopNodeIds.filter((nodeId) => nodeId !== exitNodeId),
                            });
                          }}
                        >
                          <option value="">选择最终出口</option>
                          {availableMembers
                            .filter((m) => m.nodeId !== quickTopology.entryNodeId)
                            .map((m) => (
                              <option key={m.nodeId} value={m.nodeId}>
                                {m.nodeName} · {m.ip} · {m.nodeStatus === 1 ? "在线" : "离线"}
                              </option>
                            ))}
                        </Select>
                        <Input
                          label="权重"
                          type="number"
                          min={1}
                          value={String(route.weight)}
                          onChange={(e) => updateQuickRoute(index, { weight: Math.max(1, Number(e.target.value) || 1) })}
                          mono
                        />
                      </div>

                      {/* 中间节点(按顺序) */}
                      <div>
                        <div className="text-[12px] text-muted mb-1.5">
                          中间节点（可选，按加入顺序串联）
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {route.hopNodeIds.map((nodeId, hopIdx) => (
                            <span
                              key={hopIdx}
                              className="inline-flex items-center gap-1 px-2 h-7 rounded-md bg-surface-2 border border-line text-xs text-fg"
                            >
                              {availableMembers.find((m) => m.nodeId === nodeId)?.nodeName || `#${nodeId}`}
                              <button
                                className="text-faint hover:text-danger"
                                onClick={() =>
                                  updateQuickRoute(index, {
                                    hopNodeIds: route.hopNodeIds.filter((_, i) => i !== hopIdx),
                                  })
                                }
                              >
                                ×
                              </button>
                            </span>
                          ))}
                          {hopCandidates.length > 0 ? (
                            <select
                              className="h-7 px-2 rounded-md bg-surface-2 border border-line text-xs text-muted outline-none cursor-pointer hover:border-line-strong"
                              value=""
                              disabled={!quickTopology.entryNodeId}
                              onChange={(e) => {
                                if (e.target.value) {
                                  updateQuickRoute(index, { hopNodeIds: [...route.hopNodeIds, Number(e.target.value)] });
                                }
                              }}
                            >
                              <option value="">+ 添加中间节点</option>
                              {hopCandidates.map((m) => (
                                <option key={m.nodeId} value={m.nodeId}>
                                  {m.nodeName} · {m.ip}
                                </option>
                              ))}
                            </select>
                          ) : (
                            route.hopNodeIds.length === 0 && <span className="text-xs text-faint">无可用中间节点</span>
                          )}
                        </div>
                      </div>

                      {errors[`route${index}`] && <p className="text-xs text-danger">{errors[`route${index}`]}</p>}

                      <div className="text-xs font-mono text-muted bg-surface-2 rounded-lg px-3 py-2">
                        {availableMembers.find((m) => m.nodeId === quickTopology.entryNodeId)?.nodeName || "入口"}
                        {route.hopNodeIds.map((nodeId) => (
                          <span key={nodeId}>
                            {" → "}
                            {availableMembers.find((m) => m.nodeId === nodeId)?.nodeName || `#${nodeId}`}
                          </span>
                        ))}
                        {" → "}
                        {availableMembers.find((m) => m.nodeId === route.exitNodeId)?.nodeName || "请选择出口"}
                      </div>
                    </div>
                  );
                })}
              </div>
              {errors.routes && <p className="text-xs text-danger">{errors.routes}</p>}

              <Select
                label="多路径策略"
                value={quickTopology.groupStrategy}
                onChange={(e) => setQuickTopology((current) => ({ ...current, groupStrategy: e.target.value }))}
              >
                {TARGET_STRATEGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-faint -mt-2">单线路建议失败切换；多线路可选最佳延迟、轮询或会话哈希</p>
            </div>
          ) : (
            <Select
              label="已有负载均衡组"
              value={form.groupId != null ? String(form.groupId) : ""}
              onChange={(e) => setForm({ ...form, groupId: e.target.value ? Number(e.target.value) : null })}
              error={errors.groupId}
            >
              <option value="">选择高级编排中已有的组</option>
              {groupOptions.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} · {group.linkCount} 条线路 · {strategyText(group.strategy)}
                </option>
              ))}
            </Select>
          )}

          <Textarea
            label={!isEdit && createMode === "fast" ? "③ 最终目标地址" : "最终目标地址"}
            placeholder="1.2.3.4:8096，多个用逗号或换行分隔"
            value={form.remoteAddr}
            onChange={(e) => setForm({ ...form, remoteAddr: e.target.value })}
            error={errors.remoteAddr}
            hint="目标由落地节点访问（直连模式由入口节点访问）"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="多目标选择策略"
              value={form.targetStrategy}
              onChange={(e) => setForm({ ...form, targetStrategy: e.target.value })}
            >
              {TARGET_STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Select
              label="限速规则（可选）"
              value={form.speedId != null ? String(form.speedId) : ""}
              onChange={(e) => setForm({ ...form, speedId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">不限速</option>
              {speedOptions.map((speed) => (
                <option key={speed.id} value={speed.id}>
                  {speed.name} · {speed.speed} Mbps
                </option>
              ))}
            </Select>
          </div>

          {form.remoteAddr.trim() && (
            <div className="flex items-center gap-2 text-xs text-faint">
              入口连接串:
              <code className="font-mono text-muted bg-surface-2 px-1.5 py-0.5 rounded">
                {form.name || "入口节点"}:{form.inPort ?? "自动分配"}
              </code>
              <CopyButton text={`${form.inPort ?? ""}`} />
            </div>
          )}
        </div>
      </Modal>

      {/* 删除确认 */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="删除转发"
        width="max-w-sm"
        footer={
          <>
            <Button onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="danger" onClick={handleDelete} loading={deleteLoading}>
              {forceMode ? "强制删除" : "删除"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          确定删除转发 <b className="text-fg">{deleteTarget?.name}</b> 吗?
        </p>
        <div className="mt-3 flex items-center gap-2">
          <Switch size="sm" checked={forceMode} onChange={setForceMode} />
          <span className="text-xs text-muted">强制删除 (跳过节点侧删除, 用于节点失联时)</span>
        </div>
      </Modal>

      {/* 诊断结果 */}
      <Modal
        open={!!diagnoseTarget}
        onClose={() => setDiagnoseTarget(null)}
        title={`链路诊断: ${diagnoseTarget?.name ?? ""}`}
        width="max-w-2xl"
      >
        {diagnoseLoading ? (
          <PageLoading label="诊断中..." />
        ) : diagResults.length === 0 ? (
          <EmptyState title="无诊断结果" description="该转发没有可探测的链路" />
        ) : (
          <div className="space-y-2">
            {diagResults.map((r, i) => (
              <div key={i} className="flex items-center justify-between bg-surface-2 rounded-lg px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-fg">{r.description || r.nodeName}</div>
                  <div className="text-xs text-faint">{r.nodeName}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {r.success ? (
                    <>
                      <span className="text-[13px] text-muted tnum">
                        平均 <b className="text-fg">{r.averageTime.toFixed(1)}ms</b>
                      </span>
                      <span className="text-[13px] text-muted tnum">丢包 {r.packetLoss.toFixed(0)}%</span>
                      <Badge tone="success">正常</Badge>
                    </>
                  ) : (
                    <Badge tone="danger">失败: {r.message || "不可达"}</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* 导入 */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="导入转发"
        width="max-w-xl"
        footer={
          <>
            <Button onClick={() => setImportOpen(false)}>取消</Button>
            <Button variant="primary" onClick={handleImport} loading={importLoading} disabled={!importText.trim()}>
              开始导入
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-muted">
            粘贴之前导出的 JSON（或点击
            <label className="text-accent cursor-pointer mx-0.5">
              选择文件
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setImportText(await file.text());
                }}
              />
            </label>
            ）。导入会按一体化创建流程重建线路与路由组，失败自动回滚；同名转发默认跳过。
          </p>
          <Textarea
            placeholder='{"version":1,"forwards":[...]}'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="min-h-40"
          />
          <div className="flex items-center gap-2">
            <Switch size="sm" checked={importOverwrite} onChange={setImportOverwrite} />
            <span className="text-xs text-muted">覆盖同名转发（先删除再创建）</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}

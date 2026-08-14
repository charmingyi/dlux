import { useState, useEffect } from "react";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Input, Textarea } from "@heroui/input";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import { Switch } from "@heroui/switch";
import { Select, SelectItem } from "@heroui/select";
import toast from 'react-hot-toast';

import {
  createForward,
  getForwardList,
  updateForward,
  deleteForward,
  forceDeleteForward,
  pauseForwardService,
  resumeForwardService,
  diagnoseForward,
  createForwardPlan,
  getGroupList,
  getSpeedLimitList,
  getWgNetworkList
} from "@/api";
import type { ForwardItem, GroupItem, SpeedLimit, WgNetwork } from "@/types";

const TARGET_STRATEGIES = [
  { value: 'round', label: '轮询' },
  { value: 'random', label: '加权随机' },
  { value: 'fifo', label: '失败切换' },
  { value: 'hash', label: '会话哈希' },
  { value: 'latency', label: '最佳延迟' }
];

const targetStrategyLabel = (s: string) => {
  const found = TARGET_STRATEGIES.find(i => i.value === s);
  return found ? found.label : s;
};

const formatBytes = (bytes: number) => {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
};

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
  name: '',
  groupId: null,
  remoteAddr: '',
  targetStrategy: 'fifo',
  speedId: null,
  inPort: null
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
  groupStrategy: 'fifo',
  routes: [{ exitNodeId: null, hopNodeIds: [], weight: 1 }]
};

interface DiagResult {
  nodeName?: string;
  description?: string;
  success: boolean;
  message: string;
  averageTime: number;
  packetLoss: number;
}

export default function ForwardPage() {
  const [forwardList, setForwardList] = useState<ForwardItem[]>([]);
  const [groupOptions, setGroupOptions] = useState<GroupItem[]>([]);
  const [speedOptions, setSpeedOptions] = useState<SpeedLimit[]>([]);
  const [wgOptions, setWgOptions] = useState<WgNetwork[]>([]);
  const [loading, setLoading] = useState(false);
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
  const [createMode, setCreateMode] = useState<'quick' | 'existing'>('quick');
  const [quickTopology, setQuickTopology] = useState<QuickTopology>(defaultQuickTopology);

  const loadForwards = async () => {
    setLoading(true);
    try {
      const res = await getForwardList();
      if (res.code === 0) setForwardList(res.data || []);
      else toast.error(res.msg || '加载失败');
    } catch (e) {
      toast.error('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const loadOptions = async () => {
    try {
      const [groupRes, speedRes, wgRes] = await Promise.all([
        getGroupList(), getSpeedLimitList(), getWgNetworkList()
      ]);
      if (groupRes.code === 0) setGroupOptions(groupRes.data || []);
      if (speedRes.code === 0) setSpeedOptions(speedRes.data || []);
      if (wgRes.code === 0) setWgOptions(wgRes.data || []);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    loadForwards();
    loadOptions();
    const timer = setInterval(loadForwards, 60000);
    return () => clearInterval(timer);
  }, []);

  const openCreate = () => {
    setForm(defaultForm);
    setQuickTopology(defaultQuickTopology);
    setCreateMode('quick');
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
      targetStrategy: forward.targetStrategy || 'fifo',
      speedId: forward.speedId ?? null,
      inPort: forward.inPort
    });
    setIsEdit(true);
    setCreateMode('existing');
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = '请输入转发名称';
    if ((isEdit || createMode === 'existing') && form.groupId == null) errs.groupId = '请选择负载均衡组';
	if (!isEdit && createMode === 'quick') {
	  if (quickTopology.wgNetworkId == null) errs.wgNetworkId = '请选择 WireGuard 组网';
	  if (quickTopology.entryNodeId == null) errs.entryNodeId = '请选择入口节点';
	  if (!quickTopology.routes.length) errs.routes = '至少添加一条线路';
	  quickTopology.routes.forEach((route, index) => {
	    if (route.exitNodeId == null) errs[`route${index}`] = `第 ${index + 1} 条线路缺少出口节点`;
	    if (route.exitNodeId === quickTopology.entryNodeId) errs[`route${index}`] = `第 ${index + 1} 条线路的出口不能等于入口`;
	    const order = [quickTopology.entryNodeId, ...route.hopNodeIds, route.exitNodeId].filter(v => v != null);
	    if (new Set(order).size !== order.length) errs[`route${index}`] = `第 ${index + 1} 条线路存在重复节点`;
	  });
	}
    if (!form.remoteAddr.trim()) errs.remoteAddr = '请输入目标地址';
    if (form.remoteAddr.trim().split(/[,，\n]/).filter(s => s.trim()).some(s => !s.trim().includes(':'))) {
      errs.remoteAddr = '目标地址格式应为 ip:port, 多个用逗号分隔';
    }
    if (form.inPort != null && (form.inPort < 1 || form.inPort > 65535)) {
      errs.inPort = '端口范围 1-65535';
    }
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
        remoteAddr: form.remoteAddr.trim().split(/[,，\n]/).map(s => s.trim()).filter(Boolean).join(','),
        targetStrategy: form.targetStrategy,
        speedId: form.speedId,
        inPort: form.inPort
      };
      const res = isEdit
        ? await updateForward({ id: form.id, ...payload })
        : createMode === 'quick'
          ? await createForwardPlan({
              name: form.name,
              entryNodeId: quickTopology.entryNodeId,
              wgNetworkId: quickTopology.wgNetworkId,
              routes: quickTopology.routes.map((route, index) => ({
                name: `${form.name} · 路径${index + 1}`,
                exitNodeId: route.exitNodeId,
                hopNodeIds: route.hopNodeIds,
                weight: route.weight
              })),
              groupStrategy: quickTopology.groupStrategy,
              maxFails: 1,
              failTimeout: '30s',
              remoteAddr: payload.remoteAddr,
              targetStrategy: payload.targetStrategy,
              speedId: payload.speedId,
              inPort: payload.inPort
            })
          : await createForward(payload);
      if (res.code === 0) {
        toast.success(isEdit ? '转发更新成功' : createMode === 'quick' ? '组网线路、路由组和转发已一体化创建' : '转发创建成功');
        setDialogOpen(false);
        loadForwards();
        loadOptions();
      } else {
        toast.error(res.msg || '操作失败');
      }
    } catch (e) {
      toast.error('网络错误，请重试');
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
        toast.success('转发删除成功');
        setDeleteTarget(null);
        loadForwards();
      } else {
        toast.error(res.msg || '删除失败');
      }
    } catch (e) {
      toast.error('网络错误，请重试');
    } finally {
      setDeleteLoading(false);
    }
  };

  const toggleService = async (forward: ForwardItem) => {
    try {
      const res = forward.status === 1
        ? await pauseForwardService(forward.id)
        : await resumeForwardService(forward.id);
      if (res.code === 0) {
        toast.success(res.msg || '操作成功');
        loadForwards();
      } else {
        toast.error(res.msg || '操作失败');
      }
    } catch (e) {
      toast.error('网络错误，请重试');
    }
  };

  const handleDiagnose = async (forward: ForwardItem) => {
    setDiagnoseTarget(forward);
    setDiagResults([]);
    setDiagnoseLoading(true);
    try {
      const res = await diagnoseForward(forward.id);
      if (res.code === 0) {
        setDiagResults(res.data?.results || []);
      } else {
        toast.error(res.msg || '诊断失败');
      }
    } catch (e) {
      toast.error('网络错误，请重试');
    } finally {
      setDiagnoseLoading(false);
    }
  };

  const latencyChip = (ms: number, up: boolean) => (
    <Chip size="sm" variant="flat" color={!up ? 'danger' : ms < 50 ? 'success' : ms < 100 ? 'primary' : ms < 200 ? 'warning' : 'danger'}>
      {!up ? '不可达' : `${ms.toFixed(0)}ms`}
    </Chip>
  );

  const groupEntry = (groupId: number) => groupOptions.find(g => g.id === groupId);
  const selectedWg = wgOptions.find(network => network.id === quickTopology.wgNetworkId);
  const availableMembers = selectedWg?.members || [];

  const updateQuickRoute = (index: number, patch: Partial<QuickRoute>) => {
    setQuickTopology(current => ({
      ...current,
      routes: current.routes.map((route, routeIndex) => routeIndex === index ? { ...route, ...patch } : route)
    }));
  };

  const removeQuickRoute = (index: number) => {
    setQuickTopology(current => ({ ...current, routes: current.routes.filter((_, routeIndex) => routeIndex !== index) }));
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">端口转发</h2>
          <p className="text-sm text-default-500 mt-1">默认一次选择组网、路径和目标；线路与负载均衡组自动创建，高级页面仍可单独编排。</p>
        </div>
        <Button color="primary" onPress={openCreate}>新建转发</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : forwardList.length === 0 ? (
        <Card className="mt-4">
          <CardBody className="text-center text-default-500 py-16">暂无转发，点击右上角“新建转发”创建</CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {forwardList.map(forward => (
            <Card key={forward.id} className={forward.status !== 1 ? 'opacity-80' : ''}>
              <CardHeader className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold truncate">{forward.name}</span>
                  {forward.status === 1
                    ? <Chip size="sm" color="success" variant="flat">运行中</Chip>
                    : <Chip size="sm" color="danger" variant="flat">已暂停</Chip>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="flat" onPress={() => handleDiagnose(forward)}>诊断</Button>
                  <Button size="sm" variant="light" onPress={() => openEdit(forward)}>编辑</Button>
                  <Button size="sm" variant="light" color="danger" onPress={() => { setForceMode(false); setDeleteTarget(forward); }}>删除</Button>
                </div>
              </CardHeader>
              <CardBody className="pt-0 space-y-2 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip size="sm" color={forward.entryNodeStatus === 1 ? 'success' : 'danger'} variant="dot">
                    {forward.entryNodeName || `#${forward.entryNodeId}`}
                  </Chip>
                  <span className="font-mono text-default-700">:{forward.inPort}</span>
                  <span className="text-default-400">→</span>
                  <Chip size="sm" variant="flat">{forward.groupName} ({forward.linkCount}线)</Chip>
                  <Chip size="sm" color="primary" variant="flat">{forward.groupStrategy}</Chip>
                </div>
                <div className="text-xs text-default-500 space-y-0.5">
                  <div>目标: <span className="font-mono text-foreground">{forward.remoteAddr}</span></div>
                  <div className="flex items-center gap-2">
                    目标策略: <Chip size="sm" variant="flat">{targetStrategyLabel(forward.targetStrategy)}</Chip>
                    {forward.speedName && <Chip size="sm" color="warning" variant="flat">限速 {forward.speedName}</Chip>}
                  </div>
                </div>
                <div className="text-xs text-default-500">出口→目标延迟:</div>
                <div className="flex flex-wrap gap-1.5">
                  {forward.targetLatencies && forward.targetLatencies.length > 0 ? (
                    forward.targetLatencies.map((t, i) => (
                      <div key={i} className="flex items-center gap-1">
                        {latencyChip(t.ms, t.up)}
                        <span className="text-xs text-default-400 font-mono">{t.addr}</span>
                      </div>
                    ))
                  ) : (
                    <span className="text-xs text-default-400">暂无探测数据</span>
                  )}
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-default-100 dark:border-default-50">
                  <div className="text-xs text-default-500">
                    ↓ {formatBytes(forward.inFlow)} · ↑ {formatBytes(forward.outFlow)}
                  </div>
                  <Switch
                    size="sm"
                    isSelected={forward.status === 1}
                    onValueChange={() => toggleService(forward)}
                    aria-label="暂停/恢复"
                  />
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      <Modal isOpen={dialogOpen} onOpenChange={setDialogOpen} size="4xl" scrollBehavior="inside" backdrop="blur" placement="center">
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader>{isEdit ? '编辑转发' : '创建转发任务'}</ModalHeader>
              <ModalBody>
                <div className="space-y-5">
                  {!isEdit && (
                    <div className="grid grid-cols-2 gap-2 rounded-xl bg-default-100 p-1.5">
                      <Button color={createMode === 'quick' ? 'primary' : 'default'} variant={createMode === 'quick' ? 'solid' : 'light'} onPress={() => setCreateMode('quick')}>
                        一体化创建（推荐）
                      </Button>
                      <Button color={createMode === 'existing' ? 'primary' : 'default'} variant={createMode === 'existing' ? 'solid' : 'light'} onPress={() => setCreateMode('existing')}>
                        使用已有路由组
                      </Button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="转发名称" placeholder="如：Emby 香港入口" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} errorMessage={errors.name} isInvalid={!!errors.name} variant="bordered" />
                    <Input label="入口端口（留空自动分配）" type="number" placeholder="自动" value={form.inPort != null ? String(form.inPort) : ''} onChange={event => setForm({ ...form, inPort: event.target.value ? Number(event.target.value) : null })} errorMessage={errors.inPort} isInvalid={!!errors.inPort} variant="bordered" />
                  </div>

                  {!isEdit && createMode === 'quick' ? (
                    <div className="space-y-4 rounded-xl border border-primary-200 p-4">
                      <div>
                        <div className="font-semibold">1. 选择组网与入口</div>
                        <div className="text-xs text-default-500 mt-1">这里只展示已经加入 WireGuard 组网的节点；线路、中继和负载均衡组由后端自动生成。</div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Select label="WireGuard 组网" placeholder="选择已握手的组网" selectedKeys={quickTopology.wgNetworkId != null ? new Set([String(quickTopology.wgNetworkId)]) : new Set()} onSelectionChange={keys => {
                          const values = Array.from(keys);
                          setQuickTopology({ ...defaultQuickTopology, wgNetworkId: values.length ? Number(values[0]) : null });
                        }} errorMessage={errors.wgNetworkId} isInvalid={!!errors.wgNetworkId} variant="bordered">
                          {wgOptions.map(network => <SelectItem key={String(network.id)} textValue={network.name}>{network.name} · {network.mode} · {network.members.length} 节点</SelectItem>)}
                        </Select>
                        <Select label="入口节点" placeholder="客户端连接的节点" selectedKeys={quickTopology.entryNodeId != null ? new Set([String(quickTopology.entryNodeId)]) : new Set()} onSelectionChange={keys => {
                          const values = Array.from(keys);
                          const entryNodeId = values.length ? Number(values[0]) : null;
                          setQuickTopology(current => ({ ...current, entryNodeId, routes: current.routes.map(route => route.exitNodeId === entryNodeId ? { ...route, exitNodeId: null } : route) }));
                        }} errorMessage={errors.entryNodeId} isInvalid={!!errors.entryNodeId} variant="bordered" isDisabled={!selectedWg}>
                          {availableMembers.map(member => <SelectItem key={String(member.nodeId)} textValue={member.nodeName}>{member.nodeName} · {member.ip} · {member.nodeStatus === 1 ? '在线' : '离线'}</SelectItem>)}
                        </Select>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">2. 编排路径</div>
                          <div className="text-xs text-default-500">一条路径表示 入口 → 中间节点（可选）→ 出口。添加多条即可负载均衡或故障切换。</div>
                        </div>
                        <Button size="sm" color="primary" variant="flat" isDisabled={!selectedWg || quickTopology.routes.length >= 6} onPress={() => setQuickTopology(current => ({ ...current, routes: [...current.routes, { exitNodeId: null, hopNodeIds: [], weight: 1 }] }))}>添加路径</Button>
                      </div>

                      <div className="space-y-3">
                        {quickTopology.routes.map((route, index) => (
                          <div key={index} className="rounded-xl bg-default-100 p-3 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm">路径 {index + 1}</span>
                              {quickTopology.routes.length > 1 && <Button size="sm" color="danger" variant="light" onPress={() => removeQuickRoute(index)}>移除</Button>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_110px] gap-3">
                              <Select label="中间节点（可选，按选择顺序）" selectionMode="multiple" selectedKeys={new Set(route.hopNodeIds.map(String))} onSelectionChange={keys => updateQuickRoute(index, { hopNodeIds: Array.from(keys).map(Number) })} variant="bordered" isDisabled={!quickTopology.entryNodeId}>
                                {availableMembers.filter(member => member.nodeId !== quickTopology.entryNodeId && member.nodeId !== route.exitNodeId).map(member => <SelectItem key={String(member.nodeId)} textValue={member.nodeName}>{member.nodeName} · {member.ip}</SelectItem>)}
                              </Select>
                              <Select label="出口 / 落地节点" placeholder="选择最终出口" selectedKeys={route.exitNodeId != null ? new Set([String(route.exitNodeId)]) : new Set()} onSelectionChange={keys => {
                                const values = Array.from(keys);
                                const exitNodeId = values.length ? Number(values[0]) : null;
                                updateQuickRoute(index, { exitNodeId, hopNodeIds: route.hopNodeIds.filter(nodeId => nodeId !== exitNodeId) });
                              }} errorMessage={errors[`route${index}`]} isInvalid={!!errors[`route${index}`]} variant="bordered" isDisabled={!quickTopology.entryNodeId}>
                                {availableMembers.filter(member => member.nodeId !== quickTopology.entryNodeId).map(member => <SelectItem key={String(member.nodeId)} textValue={member.nodeName}>{member.nodeName} · {member.ip} · {member.nodeStatus === 1 ? '在线' : '离线'}</SelectItem>)}
                              </Select>
                              <Input label="权重" type="number" min={1} value={String(route.weight)} onChange={event => updateQuickRoute(index, { weight: Math.max(1, Number(event.target.value)) })} variant="bordered" />
                            </div>
                            <div className="text-xs font-mono text-default-500">
                              {availableMembers.find(member => member.nodeId === quickTopology.entryNodeId)?.nodeName || '入口'}
                              {' → '}{route.hopNodeIds.map(nodeId => availableMembers.find(member => member.nodeId === nodeId)?.nodeName || `#${nodeId}`).join(' → ')}
                              {route.hopNodeIds.length ? ' → ' : ''}{availableMembers.find(member => member.nodeId === route.exitNodeId)?.nodeName || '请选择出口'}
                            </div>
                          </div>
                        ))}
                      </div>
                      {errors.routes && <p className="text-xs text-danger">{errors.routes}</p>}

                      <Select label="多路径策略" selectedKeys={new Set([quickTopology.groupStrategy])} onSelectionChange={keys => {
                        const values = Array.from(keys);
                        if (values.length) setQuickTopology(current => ({ ...current, groupStrategy: String(values[0]) }));
                      }} description="单线路建议失败切换；多线路可选最佳延迟、轮询或会话哈希" variant="bordered">
                        {TARGET_STRATEGIES.map(strategy => <SelectItem key={strategy.value} textValue={strategy.label}>{strategy.label}</SelectItem>)}
                      </Select>
                    </div>
                  ) : (
                    <Select label="已有负载均衡组" placeholder="选择高级编排中已有的组" selectedKeys={form.groupId != null ? new Set([String(form.groupId)]) : new Set()} onSelectionChange={keys => {
                      const values = Array.from(keys);
                      setForm({ ...form, groupId: values.length ? Number(values[0]) : null });
                    }} errorMessage={errors.groupId} isInvalid={!!errors.groupId} variant="bordered">
                      {groupOptions.map(group => <SelectItem key={String(group.id)} textValue={group.name}>{group.name} · {group.linkCount} 条线路 · {targetStrategyLabel(group.strategy)}</SelectItem>)}
                    </Select>
                  )}

                  <Textarea label="最终目标地址（多个用逗号或换行分隔）" placeholder="1.2.3.4:8096" value={form.remoteAddr} onChange={event => setForm({ ...form, remoteAddr: event.target.value })} errorMessage={errors.remoteAddr} isInvalid={!!errors.remoteAddr} description="目标由每条路径的出口节点访问" variant="bordered" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select label="多目标选择策略" selectedKeys={new Set([form.targetStrategy])} onSelectionChange={keys => {
                      const values = Array.from(keys);
                      if (values.length) setForm({ ...form, targetStrategy: String(values[0]) });
                    }} variant="bordered">
                      {TARGET_STRATEGIES.map(strategy => <SelectItem key={strategy.value} textValue={strategy.label}>{strategy.label}</SelectItem>)}
                    </Select>
                    <Select label="限速规则（可选）" placeholder="不限速" selectedKeys={form.speedId != null ? new Set([String(form.speedId)]) : new Set()} onSelectionChange={keys => {
                      const values = Array.from(keys);
                      setForm({ ...form, speedId: values.length ? Number(values[0]) : null });
                    }} variant="bordered">
                      {speedOptions.map(speed => <SelectItem key={String(speed.id)} textValue={speed.name}>{speed.name} · {speed.speed} Mbps</SelectItem>)}
                    </Select>
                  </div>
                  {(isEdit || createMode === 'existing') && form.groupId != null && groupEntry(form.groupId) && (
                    <p className="text-xs text-default-400">该组的所有线路共享同一入口；修改到不同入口组时，后端会先清理旧入口服务再下发。</p>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>取消</Button>
                <Button color="primary" onPress={handleSubmit} isLoading={submitLoading}>{isEdit ? '保存并重下发' : createMode === 'quick' ? '创建完整转发任务' : '创建转发'}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* 删除确认 */}
      <Modal isOpen={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)} size="sm">
        <ModalContent>
          <ModalHeader>删除转发</ModalHeader>
          <ModalBody>
            <p>确定删除转发 <b>{deleteTarget?.name}</b> 吗?</p>
            <div className="mt-2 flex items-center gap-2">
              <Switch size="sm" isSelected={forceMode} onValueChange={setForceMode} aria-label="强制删除" />
              <span className="text-xs text-default-500">强制删除 (跳过节点侧删除, 用于节点失联时)</span>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button color="default" variant="light" onPress={() => setDeleteTarget(null)}>取消</Button>
            <Button color="danger" onPress={handleDelete} isLoading={deleteLoading}>
              {forceMode ? '强制删除' : '删除'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* 诊断结果 */}
      <Modal
        isOpen={!!diagnoseTarget}
        onOpenChange={() => setDiagnoseTarget(null)}
        size="2xl"
        scrollBehavior="inside"
        backdrop="blur"
      >
        <ModalContent>
          <ModalHeader>诊断: {diagnoseTarget?.name}</ModalHeader>
          <ModalBody>
            {diagnoseLoading ? (
              <div className="flex justify-center py-10"><Spinner size="lg" /></div>
            ) : diagResults.length === 0 ? (
              <div className="text-center text-default-500 py-10">无诊断结果</div>
            ) : (
              <div className="space-y-2">
                {diagResults.map((r, i) => (
                  <div key={i} className="flex items-center justify-between bg-default-100 dark:bg-default-50 rounded-lg px-4 py-3">
                    <div>
                      <div className="text-sm font-medium">{r.description || r.nodeName}</div>
                      <div className="text-xs text-default-500">{r.nodeName}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {r.success ? (
                        <>
                          <div className="text-sm">
                            平均延迟 <span className="font-semibold text-primary">{r.averageTime.toFixed(1)}ms</span>
                          </div>
                          <div className="text-sm">
                            丢包 <span className="font-semibold">{r.packetLoss.toFixed(0)}%</span>
                          </div>
                          <Chip size="sm" color="success" variant="flat">正常</Chip>
                        </>
                      ) : (
                        <Chip size="sm" color="danger" variant="flat">失败: {r.message || '不可达'}</Chip>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button color="default" variant="light" onPress={() => setDiagnoseTarget(null)}>关闭</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

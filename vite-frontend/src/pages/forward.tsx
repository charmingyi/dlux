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
  getGroupList,
  getSpeedLimitList
} from "@/api";
import type { ForwardItem, GroupItem, SpeedLimit } from "@/types";

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
      const [groupRes, speedRes] = await Promise.all([getGroupList(), getSpeedLimitList()]);
      if (groupRes.code === 0) setGroupOptions(groupRes.data || []);
      if (speedRes.code === 0) setSpeedOptions(speedRes.data || []);
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
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = '请输入转发名称';
    if (form.groupId == null) errs.groupId = '请选择负载均衡组';
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
      const res = isEdit ? await updateForward({ id: form.id, ...payload }) : await createForward(payload);
      if (res.code === 0) {
        toast.success(isEdit ? '转发更新成功' : '转发创建成功');
        setDialogOpen(false);
        loadForwards();
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

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">端口转发</h2>
          <p className="text-sm text-default-500 mt-1">转发 = 入口端口 → 负载均衡组(多线路) → 目标</p>
        </div>
        <Button color="primary" onPress={openCreate}>新建转发</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : forwardList.length === 0 ? (
        <Card className="mt-4">
          <CardBody className="text-center text-default-500 py-16">暂无转发, 点击右上角"新建转发"创建</CardBody>
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
      <Modal isOpen={dialogOpen} onOpenChange={setDialogOpen} size="2xl" backdrop="blur" placement="center">
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader>{isEdit ? '编辑转发' : '新建转发'}</ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="转发名称"
                      placeholder="如: 网站80端口"
                      value={form.name}
                      onChange={e => setForm({ ...form, name: e.target.value })}
                      errorMessage={errors.name}
                      isInvalid={!!errors.name}
                      variant="bordered"
                    />
                    <Input
                      label="入口端口 (留空自动分配)"
                      type="number"
                      placeholder="自动"
                      value={form.inPort != null ? String(form.inPort) : ''}
                      onChange={e => setForm({ ...form, inPort: e.target.value ? Number(e.target.value) : null })}
                      errorMessage={errors.inPort}
                      isInvalid={!!errors.inPort}
                      variant="bordered"
                    />
                  </div>
                  <Select
                    label="负载均衡组"
                    placeholder="选择组"
                    selectedKeys={form.groupId != null ? new Set([String(form.groupId)]) : new Set()}
                    onSelectionChange={keys => {
                      const arr = Array.from(keys);
                      setForm({ ...form, groupId: arr.length ? Number(arr[0]) : null });
                    }}
                    errorMessage={errors.groupId}
                    isInvalid={!!errors.groupId}
                    variant="bordered"
                  >
                    {groupOptions.map(group => (
                      <SelectItem key={String(group.id)} textValue={group.name}>
                        {group.name} ({group.linkCount}线 · {group.strategy})
                      </SelectItem>
                    ))}
                  </Select>
                  <Textarea
                    label="目标地址 (多个用逗号分隔)"
                    placeholder="1.2.3.4:80, 5.6.7.8:80"
                    value={form.remoteAddr}
                    onChange={e => setForm({ ...form, remoteAddr: e.target.value })}
                    errorMessage={errors.remoteAddr}
                    isInvalid={!!errors.remoteAddr}
                    variant="bordered"
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Select
                      label="目标选择策略"
                      selectedKeys={new Set([form.targetStrategy])}
                      onSelectionChange={keys => {
                        const arr = Array.from(keys);
                        if (arr.length) setForm({ ...form, targetStrategy: String(arr[0]) });
                      }}
                      variant="bordered"
                    >
                      {TARGET_STRATEGIES.map(s => (
                        <SelectItem key={s.value} textValue={s.label}>{s.label}</SelectItem>
                      ))}
                    </Select>
                    <Select
                      label="限速规则 (可选)"
                      placeholder="不限速"
                      selectedKeys={form.speedId != null ? new Set([String(form.speedId)]) : new Set()}
                      onSelectionChange={keys => {
                        const arr = Array.from(keys);
                        setForm({ ...form, speedId: arr.length ? Number(arr[0]) : null });
                      }}
                      variant="bordered"
                    >
                      {speedOptions.map(s => (
                        <SelectItem key={String(s.id)} textValue={s.name}>{s.name} ({s.speed}Mbps)</SelectItem>
                      ))}
                    </Select>
                  </div>
                  {form.groupId != null && (() => {
                    const group = groupEntry(form.groupId);
                    return group ? (
                      <p className="text-xs text-default-400">
                        入口节点: 组内线路共享入口 · 目标延迟由各线路出口节点实测
                      </p>
                    ) : null;
                  })()}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button color="default" variant="light" onPress={onClose}>取消</Button>
                <Button color="primary" onPress={handleSubmit} isLoading={submitLoading}>确定</Button>
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

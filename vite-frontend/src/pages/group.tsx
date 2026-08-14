import { useState, useEffect } from "react";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import { Select, SelectItem } from "@heroui/select";
import toast from 'react-hot-toast';

import { createGroup, getGroupList, updateGroup, deleteGroup, getLinkList } from "@/api";
import type { GroupItem, LinkItem } from "@/types";

const STRATEGIES = [
  { value: 'round', label: '轮询 (round)' },
  { value: 'random', label: '加权随机 (random)' },
  { value: 'fifo', label: '失败切换 (fifo)' },
  { value: 'hash', label: '会话哈希 (hash)' },
  { value: 'latency', label: '最佳延迟 (latency)' }
];

const strategyLabel = (s: string) => {
  const found = STRATEGIES.find(i => i.value === s);
  return found ? found.label : s;
};

interface GroupForm {
  id: number | null;
  name: string;
  strategy: string;
  maxFails: number;
  failTimeout: string;
  linkIds: number[];
  weights: number[];
}

const defaultForm: GroupForm = {
  id: null,
  name: '',
  strategy: 'round',
  maxFails: 1,
  failTimeout: '600s',
  linkIds: [],
  weights: []
};

export default function GroupPage() {
  const [groupList, setGroupList] = useState<GroupItem[]>([]);
  const [linkOptions, setLinkOptions] = useState<LinkItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GroupItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [form, setForm] = useState<GroupForm>(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadGroups = async () => {
    setLoading(true);
    try {
      const res = await getGroupList();
      if (res.code === 0) setGroupList(res.data || []);
      else toast.error(res.msg || '加载失败');
    } catch (e) {
      toast.error('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const loadLinks = async () => {
    try {
      const res = await getLinkList();
      if (res.code === 0) setLinkOptions(res.data || []);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    loadGroups();
    loadLinks();
  }, []);

  const openCreate = () => {
    setForm(defaultForm);
    setIsEdit(false);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (group: GroupItem) => {
    setForm({
      id: group.id,
      name: group.name,
      strategy: group.strategy,
      maxFails: group.maxFails ?? 1,
      failTimeout: group.failTimeout || '600s',
      linkIds: group.links.map(l => l.linkId),
      weights: group.links.map(l => l.weight || 1)
    });
    setIsEdit(true);
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = '请输入组名称';
    if (!form.linkIds.length) errs.linkIds = '请至少选择一条线路';
    if (form.linkIds.length > 1) {
      const selected = linkOptions.filter(l => form.linkIds.includes(l.id));
      const entryNodes = new Set(selected.map(l => l.entryNodeId));
      if (entryNodes.size > 1) errs.linkIds = '组内所有线路必须使用同一入口节点';
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
        strategy: form.strategy,
        maxFails: form.maxFails,
        failTimeout: form.failTimeout,
        linkIds: form.linkIds,
        weights: form.linkIds.map((id, i) => form.weights[i] || 1)
      };
      const res = isEdit ? await updateGroup({ id: form.id, ...payload }) : await createGroup(payload);
      if (res.code === 0) {
        toast.success(isEdit ? '组更新成功' : '组创建成功');
        setDialogOpen(false);
        loadGroups();
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
      const res = await deleteGroup(deleteTarget.id);
      if (res.code === 0) {
        toast.success('组删除成功');
        setDeleteTarget(null);
        loadGroups();
      } else {
        toast.error(res.msg || '删除失败');
      }
    } catch (e) {
      toast.error('网络错误，请重试');
    } finally {
      setDeleteLoading(false);
    }
  };

  const onLinkSelect = (ids: number[]) => {
    const weights = ids.map(id => {
      const idx = form.linkIds.indexOf(id);
      return idx >= 0 ? (form.weights[idx] || 1) : 1;
    });
    setForm({ ...form, linkIds: ids, weights });
  };

  const setWeight = (index: number, weight: number) => {
    const weights = [...form.weights];
    weights[index] = weight;
    setForm({ ...form, weights });
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">负载均衡组</h2>
          <p className="text-sm text-default-500 mt-1">组内线路共享同一入口节点, 按策略选择线路出口</p>
        </div>
        <Button color="primary" onPress={openCreate}>新建组</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : groupList.length === 0 ? (
        <Card className="mt-4">
          <CardBody className="text-center text-default-500 py-16">暂无负载均衡组, 点击右上角"新建组"创建</CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groupList.map(group => (
            <Card key={group.id}>
              <CardHeader className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{group.name}</span>
                  <Chip size="sm" color="primary" variant="flat">{strategyLabel(group.strategy)}</Chip>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="light" onPress={() => openEdit(group)}>编辑</Button>
                  <Button size="sm" variant="light" color="danger" onPress={() => setDeleteTarget(group)}>删除</Button>
                </div>
              </CardHeader>
              <CardBody className="pt-0 space-y-2 text-sm">
                <div className="flex gap-4 text-xs text-default-500">
                  <span>线路: <span className="text-foreground">{group.linkCount}</span></span>
                  <span>转发: <span className="text-foreground">{group.forwardCount}</span></span>
                  {group.maxFails != null && (
                    <span>失败{group.maxFails}次摘除 · {group.failTimeout}恢复</span>
                  )}
                </div>
                <div className="space-y-1">
                  {group.links.map((link, i) => (
                    <div key={link.linkId} className="flex items-center justify-between bg-default-100 dark:bg-default-50 rounded-lg px-3 py-1.5">
                      <span>{link.linkName}</span>
                      <div className="flex items-center gap-2 text-xs text-default-500">
                        <span>出口 #{link.exitNodeId}</span>
                        <Chip size="sm" variant="flat">{link.transport}</Chip>
                        {group.strategy === 'random' && <span>权重 {link.weight}</span>}
                      </div>
                    </div>
                  ))}
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
              <ModalHeader>{isEdit ? '编辑组' : '新建组'}</ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <Input
                    label="组名称"
                    placeholder="如: 华东多线路组"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    errorMessage={errors.name}
                    isInvalid={!!errors.name}
                    variant="bordered"
                  />
                  <div className="grid grid-cols-3 gap-4">
                    <Select
                      label="均衡策略"
                      selectedKeys={new Set([form.strategy])}
                      onSelectionChange={keys => {
                        const arr = Array.from(keys);
                        if (arr.length) setForm({ ...form, strategy: String(arr[0]) });
                      }}
                      variant="bordered"
                    >
                      {STRATEGIES.map(s => (
                        <SelectItem key={s.value} textValue={s.label}>{s.label}</SelectItem>
                      ))}
                    </Select>
                    <Input
                      label="失败次数"
                      type="number"
                      value={String(form.maxFails)}
                      onChange={e => setForm({ ...form, maxFails: Number(e.target.value) || 1 })}
                      variant="bordered"
                    />
                    <Input
                      label="恢复时间"
                      placeholder="600s"
                      value={form.failTimeout}
                      onChange={e => setForm({ ...form, failTimeout: e.target.value })}
                      variant="bordered"
                    />
                  </div>
                  <Select
                    label="组内线路 (需同一入口节点)"
                    selectionMode="multiple"
                    placeholder="选择线路"
                    selectedKeys={new Set(form.linkIds.map(String))}
                    onSelectionChange={keys => onLinkSelect(Array.from(keys).map(Number))}
                    errorMessage={errors.linkIds}
                    isInvalid={!!errors.linkIds}
                    variant="bordered"
                  >
                    {linkOptions.map(link => (
                      <SelectItem key={String(link.id)} textValue={link.name}>
                        {link.name} (入口#{link.entryNodeId} → 出口#{link.exitNodeId})
                      </SelectItem>
                    ))}
                  </Select>
                  {form.strategy === 'random' && form.linkIds.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-sm text-default-500">线路权重 (仅加权随机生效):</div>
                      {form.linkIds.map((id, i) => {
                        const link = linkOptions.find(l => l.id === id);
                        return (
                          <div key={id} className="flex items-center gap-3">
                            <span className="text-sm flex-1">{link?.name || `#${id}`}</span>
                            <Input
                              className="w-28"
                              type="number"
                              size="sm"
                              min={1}
                              value={String(form.weights[i] || 1)}
                              onChange={e => setWeight(i, Number(e.target.value) || 1)}
                              variant="bordered"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="text-xs text-default-400">
                    轮询: 依次选择线路 · 失败切换: 固定首选线路, 失败后切换 · 最佳延迟: 按节点实测延迟选择最优线路, 无数据时回退轮询
                  </p>
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
          <ModalHeader>删除组</ModalHeader>
          <ModalBody>
            确定删除负载均衡组 <b>{deleteTarget?.name}</b> 吗? 使用该组的转发需先删除。
          </ModalBody>
          <ModalFooter>
            <Button color="default" variant="light" onPress={() => setDeleteTarget(null)}>取消</Button>
            <Button color="danger" onPress={handleDelete} isLoading={deleteLoading}>删除</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

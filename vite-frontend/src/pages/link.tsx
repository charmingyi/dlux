import { useState, useEffect } from "react";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import { Select, SelectItem } from "@heroui/select";
import { Radio, RadioGroup } from "@heroui/radio";
import toast from 'react-hot-toast';

import {
  createLink,
  getLinkList,
  updateLink,
  deleteLink,
  redeployLink,
  getWgNetworkList,
  getNodeList
} from "@/api";
import type { LinkItem } from "@/types";

interface NodeOption {
  id: number;
  name: string;
  status: number;
}

interface WgOption {
  id: number;
  name: string;
}

interface LinkForm {
  id: number | null;
  name: string;
  wgNetworkId: number | null;
  transport: 'wg' | 'tls' | 'tcp';
  entryNodeId: number | null;
  exitNodeId: number | null;
  hopNodeIds: number[];
}

const defaultForm: LinkForm = {
  id: null,
  name: '',
  wgNetworkId: null,
  transport: 'wg',
  entryNodeId: null,
  exitNodeId: null,
  hopNodeIds: []
};

const strategyText = (s: string) => ({ wg: '组网', tls: 'TLS', tcp: 'TCP' } as Record<string, string>)[s] || s;

const latencyView = (item: LinkItem) => {
  if (!item.latencies) return null;
  const entries = Object.values(item.latencies);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {entries.map((e, i) => (
        <Chip key={i} size="sm" variant="flat" color={e.up ? (e.ms < 50 ? 'success' : e.ms < 100 ? 'primary' : 'warning') : 'danger'}>
          {e.addr} {e.up ? `${e.ms.toFixed(0)}ms` : '不可达'}
        </Chip>
      ))}
    </div>
  );
};

export default function LinkPage() {
  const [linkList, setLinkList] = useState<LinkItem[]>([]);
  const [nodeOptions, setNodeOptions] = useState<NodeOption[]>([]);
  const [wgOptions, setWgOptions] = useState<WgOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LinkItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [form, setForm] = useState<LinkForm>(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadLinks = async () => {
    setLoading(true);
    try {
      const res = await getLinkList();
      if (res.code === 0) setLinkList(res.data || []);
      else toast.error(res.msg || '加载失败');
    } catch (e) {
      toast.error('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const loadOptions = async () => {
    try {
      const [nodeRes, wgRes] = await Promise.all([getNodeList(), getWgNetworkList()]);
      if (nodeRes.code === 0) setNodeOptions(nodeRes.data || []);
      if (wgRes.code === 0) setWgOptions(wgRes.data || []);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    loadLinks();
    loadOptions();
    const timer = setInterval(loadLinks, 60000);
    return () => clearInterval(timer);
  }, []);

  const openCreate = () => {
    setForm(defaultForm);
    setIsEdit(false);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (link: LinkItem) => {
    let hops: number[] = [];
    try {
      hops = link.hopNodeIds ? JSON.parse(link.hopNodeIds) : [];
    } catch (e) {
      hops = [];
    }
    setForm({
      id: link.id,
      name: link.name,
      wgNetworkId: link.wgNetworkId ?? null,
      transport: link.transport,
      entryNodeId: link.entryNodeId,
      exitNodeId: link.exitNodeId,
      hopNodeIds: hops
    });
    setIsEdit(true);
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = '请输入线路名称';
    if (form.entryNodeId == null) errs.entryNodeId = '请选择入口节点';
    if (form.exitNodeId == null) errs.exitNodeId = '请选择出口节点';
    if (form.transport === 'wg' && form.wgNetworkId == null) errs.wgNetworkId = '组网传输必须选择组网';
    if (form.entryNodeId != null && form.exitNodeId != null && form.entryNodeId === form.exitNodeId && form.hopNodeIds.length > 0) {
      errs.hopNodeIds = '直连线路(入口=出口)不能有中间节点';
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
        wgNetworkId: form.transport === 'wg' ? form.wgNetworkId : null,
        transport: form.transport,
        entryNodeId: form.entryNodeId,
        exitNodeId: form.exitNodeId,
        hopNodeIds: form.hopNodeIds
      };
      const res = isEdit ? await updateLink({ id: form.id, ...payload }) : await createLink(payload);
      if (res.code === 0) {
        toast.success(isEdit ? '线路更新成功' : '线路创建成功');
        setDialogOpen(false);
        loadLinks();
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
      const res = await deleteLink(deleteTarget.id);
      if (res.code === 0) {
        toast.success('线路删除成功');
        setDeleteTarget(null);
        loadLinks();
      } else {
        toast.error(res.msg || '删除失败');
      }
    } catch (e) {
      toast.error('网络错误，请重试');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRedeploy = async (link: LinkItem) => {
    try {
      const res = await redeployLink(link.id);
      if (res.code === 0) toast.success('线路重新下发成功');
      else toast.error(res.msg || '重新下发失败');
    } catch (e) {
      toast.error('网络错误，请重试');
    }
  };

  const hopNames = (link: LinkItem) => {
    const nameMap = new Map(nodeOptions.map(n => [n.id, n.name]));
    let hops: number[] = [];
    try {
      hops = link.hopNodeIds ? JSON.parse(link.hopNodeIds) : [];
    } catch (e) {
      hops = [];
    }
    return hops.map(id => nameMap.get(id) || `#${id}`);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">线路管理</h2>
          <p className="text-sm text-default-500 mt-1">线路 = 入口 → 中间节点 → 出口(落地), 可基于组网或直连</p>
        </div>
        <Button color="primary" onPress={openCreate}>新建线路</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : linkList.length === 0 ? (
        <Card className="mt-4">
          <CardBody className="text-center text-default-500 py-16">暂无线路, 点击右上角"新建线路"创建</CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {linkList.map(link => {
            const entryOnline = link.entryNodeStatus === 1;
            const exitOnline = link.exitNodeStatus === 1;
            return (
              <Card key={link.id}>
                <CardHeader className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{link.name}</span>
                    <Chip size="sm" color="primary" variant="flat">{strategyText(link.transport)}</Chip>
                    {link.wgNetworkName && <Chip size="sm" variant="flat">{link.wgNetworkName}</Chip>}
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" variant="flat" onPress={() => handleRedeploy(link)}>重发</Button>
                    <Button size="sm" variant="light" onPress={() => openEdit(link)}>编辑</Button>
                    <Button size="sm" variant="light" color="danger" onPress={() => setDeleteTarget(link)}>删除</Button>
                  </div>
                </CardHeader>
                <CardBody className="pt-0 space-y-2 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Chip size="sm" color={entryOnline ? 'success' : 'danger'} variant="dot">{link.entryNodeName || `#${link.entryNodeId}`}</Chip>
                    <span className="text-default-400">→</span>
                    {hopNames(link).map((name, i) => (
                      <span key={i} className="flex items-center gap-2">
                        <Chip size="sm" variant="flat">{name}</Chip>
                        <span className="text-default-400">→</span>
                      </span>
                    ))}
                    <Chip size="sm" color={exitOnline ? 'success' : 'danger'} variant="dot">{link.exitNodeName || `#${link.exitNodeId}`}</Chip>
                  </div>
                  <div className="text-xs text-default-500">
                    共 {link.nodeCount || 2} 个节点 · 入口组网IP: {link.entryWgIp || '--'}
                  </div>
                  <div className="text-xs text-default-500">入口→各端点延迟:</div>
                  {latencyView(link)}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      <Modal isOpen={dialogOpen} onOpenChange={setDialogOpen} size="2xl" backdrop="blur" placement="center">
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader>{isEdit ? '编辑线路' : '新建线路'}</ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <Input
                    label="线路名称"
                    placeholder="如: 华东A线"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    errorMessage={errors.name}
                    isInvalid={!!errors.name}
                    variant="bordered"
                  />
                  <RadioGroup
                    label="节点间传输"
                    orientation="horizontal"
                    value={form.transport}
                    onValueChange={v => setForm({ ...form, transport: v as LinkForm['transport'] })}
                  >
                    <Radio value="wg">组网(WG)</Radio>
                    <Radio value="tls">TLS</Radio>
                    <Radio value="tcp">TCP</Radio>
                  </RadioGroup>
                  {form.transport === 'wg' && (
                    <Select
                      label="组网"
                      placeholder="选择组网"
                      selectedKeys={form.wgNetworkId != null ? new Set([String(form.wgNetworkId)]) : new Set()}
                      onSelectionChange={keys => {
                        const arr = Array.from(keys);
                        setForm({ ...form, wgNetworkId: arr.length ? Number(arr[0]) : null });
                      }}
                      errorMessage={errors.wgNetworkId}
                      isInvalid={!!errors.wgNetworkId}
                      variant="bordered"
                    >
                      {wgOptions.map(wg => (
                        <SelectItem key={String(wg.id)} textValue={wg.name}>{wg.name} ({wg.name})</SelectItem>
                      ))}
                    </Select>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <Select
                      label="入口节点"
                      placeholder="选择入口节点"
                      selectedKeys={form.entryNodeId != null ? new Set([String(form.entryNodeId)]) : new Set()}
                      onSelectionChange={keys => {
                        const arr = Array.from(keys);
                        setForm({ ...form, entryNodeId: arr.length ? Number(arr[0]) : null });
                      }}
                      errorMessage={errors.entryNodeId}
                      isInvalid={!!errors.entryNodeId}
                      variant="bordered"
                    >
                      {nodeOptions.map(node => (
                        <SelectItem key={String(node.id)} textValue={node.name}>
                          {node.name} {node.status === 1 ? '(在线)' : '(离线)'}
                        </SelectItem>
                      ))}
                    </Select>
                    <Select
                      label="出口(落地)节点"
                      placeholder="选择出口节点"
                      selectedKeys={form.exitNodeId != null ? new Set([String(form.exitNodeId)]) : new Set()}
                      onSelectionChange={keys => {
                        const arr = Array.from(keys);
                        setForm({ ...form, exitNodeId: arr.length ? Number(arr[0]) : null });
                      }}
                      errorMessage={errors.exitNodeId}
                      isInvalid={!!errors.exitNodeId}
                      variant="bordered"
                    >
                      {nodeOptions.map(node => (
                        <SelectItem key={String(node.id)} textValue={node.name}>
                          {node.name} {node.status === 1 ? '(在线)' : '(离线)'}
                        </SelectItem>
                      ))}
                    </Select>
                  </div>
                  <Select
                    label="中间节点(可选, 按顺序多跳)"
                    selectionMode="multiple"
                    placeholder="选择中间节点"
                    selectedKeys={new Set(form.hopNodeIds.map(String))}
                    onSelectionChange={keys => setForm({ ...form, hopNodeIds: Array.from(keys).map(Number) })}
                    errorMessage={errors.hopNodeIds}
                    isInvalid={!!errors.hopNodeIds}
                    variant="bordered"
                  >
                    {nodeOptions
                      .filter(n => n.id !== form.entryNodeId && n.id !== form.exitNodeId)
                      .map(node => (
                        <SelectItem key={String(node.id)} textValue={node.name}>
                          {node.name} {node.status === 1 ? '(在线)' : '(离线)'}
                        </SelectItem>
                      ))}
                  </Select>
                  {form.entryNodeId != null && form.exitNodeId != null && form.entryNodeId === form.exitNodeId && (
                    <p className="text-xs text-default-400">入口=出口时为直连线路, 无需组网</p>
                  )}
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
          <ModalHeader>删除线路</ModalHeader>
          <ModalBody>
            确定删除线路 <b>{deleteTarget?.name}</b> 吗? 将移除所有中继服务与链配置。
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

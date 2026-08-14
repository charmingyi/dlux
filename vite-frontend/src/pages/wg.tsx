import { useState, useEffect } from "react";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import { Radio, RadioGroup } from "@heroui/radio";
import { Select, SelectItem } from "@heroui/select";
import toast from 'react-hot-toast';

import {
  createWgNetwork,
  getWgNetworkList,
  updateWgNetwork,
  deleteWgNetwork,
  syncWgNetwork,
  getNodeList
} from "@/api";
import type { WgNetwork } from "@/types";

interface NodeOption {
  id: number;
  name: string;
  status: number;
}

interface WgForm {
  id: number | null;
  name: string;
  subnet: string;
  mode: 'mesh' | 'hub';
  listenPort: number;
  mtu: number;
  nodeIds: number[];
}

const defaultForm: WgForm = {
  id: null,
  name: '',
  subnet: '10.10.0.0/24',
  mode: 'mesh',
  listenPort: 51820,
  mtu: 1420,
  nodeIds: []
};

export default function WgPage() {
  const [networkList, setNetworkList] = useState<WgNetwork[]>([]);
  const [nodeOptions, setNodeOptions] = useState<NodeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WgNetwork | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [form, setForm] = useState<WgForm>(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadNetworks = async () => {
    setLoading(true);
    try {
      const res = await getWgNetworkList();
      if (res.code === 0) setNetworkList(res.data || []);
      else toast.error(res.msg || '加载失败');
    } catch (e) {
      toast.error('网络错误，请重试');
    } finally {
      setLoading(false);
    }
  };

  const loadNodes = async () => {
    try {
      const res = await getNodeList();
      if (res.code === 0) setNodeOptions(res.data || []);
    } catch (e) {
      // ignore
    }
  };

  useEffect(() => {
    loadNetworks();
    loadNodes();
  }, []);

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
      nodeIds: network.members.map(m => m.nodeId)
    });
    setIsEdit(true);
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = '请输入组网名称';
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(form.subnet)) errs.subnet = '网段格式错误, 如 10.10.0.0/24';
    if (!form.listenPort || form.listenPort < 1024 || form.listenPort > 65535) errs.listenPort = '端口需在1024-65535之间';
    if (!form.nodeIds.length) errs.nodeIds = '请至少选择一个节点';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitLoading(true);
    try {
      const payload = {
        name: form.name,
        subnet: form.subnet,
        mode: form.mode,
        listenPort: form.listenPort,
        mtu: form.mtu,
        members: form.nodeIds.map(id => ({ nodeId: id }))
      };
      const res = isEdit ? await updateWgNetwork({ id: form.id, ...payload }) : await createWgNetwork(payload);
      if (res.code === 0) {
        toast.success(isEdit ? '组网更新成功' : '组网创建成功');
        setDialogOpen(false);
        loadNetworks();
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
      const res = await deleteWgNetwork(deleteTarget.id);
      if (res.code === 0) {
        toast.success('组网删除成功');
        setDeleteTarget(null);
        loadNetworks();
      } else {
        toast.error(res.msg || '删除失败');
      }
    } catch (e) {
      toast.error('网络错误，请重试');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSync = async (network: WgNetwork) => {
    toast.loading('正在同步组网...', { id: 'wg-sync' });
    try {
      const res = await syncWgNetwork(network.id);
      toast.dismiss('wg-sync');
      if (res.code === 0) {
        toast.success(res.msg || '同步完成');
        loadNetworks();
      } else {
        toast.error(res.msg || '同步失败');
      }
    } catch (e) {
      toast.dismiss('wg-sync');
      toast.error('网络错误，请重试');
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">WireGuard 组网</h2>
          <p className="text-sm text-default-500 mt-1">节点间通过 WireGuard 组成加密内网, 线路基于组网转发</p>
        </div>
        <Button color="primary" onPress={openCreate}>新建组网</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : networkList.length === 0 ? (
        <Card className="mt-4">
          <CardBody className="text-center text-default-500 py-16">暂无组网, 点击右上角"新建组网"创建</CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {networkList.map(network => (
            <Card key={network.id}>
              <CardHeader className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{network.name}</span>
                  <Chip size="sm" color="primary" variant="flat">{network.mode === 'mesh' ? '全互联' : '中心-分支'}</Chip>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="flat" onPress={() => handleSync(network)}>同步</Button>
                  <Button size="sm" variant="light" onPress={() => openEdit(network)}>编辑</Button>
                  <Button size="sm" variant="light" color="danger" onPress={() => setDeleteTarget(network)}>删除</Button>
                </div>
              </CardHeader>
              <CardBody className="pt-0 space-y-2 text-sm">
                <div className="flex gap-4 text-default-500">
                  <span>网段: <span className="text-foreground">{network.subnet}</span></span>
                  <span>端口: <span className="text-foreground">{network.listenPort}</span></span>
                </div>
                <div className="space-y-1">
                  {network.members.map(member => (
                    <div key={member.id} className="bg-default-100 dark:bg-default-50 rounded-lg px-3 py-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Chip size="sm" color={member.nodeStatus === 1 ? 'success' : 'danger'} variant="dot">
                            {member.nodeName}
                          </Chip>
                          {member.hub === 1 && <Chip size="sm" color="warning" variant="flat">中心</Chip>}
                          <span className="text-default-500 text-xs">{member.ip}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-default-400 font-mono max-w-[140px] truncate">
                            {member.publicKey ? member.publicKey.slice(0, 16) + '...' : '未同步'}
                          </span>
                        </div>
                      </div>
                      {member.latencies && Object.keys(member.latencies).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5 pl-1">
                          {Object.values(member.latencies).map((p: any, i: number) => (
                            <Chip key={i} size="sm" variant="flat"
                              color={!p.up ? 'danger' : p.ms < 50 ? 'success' : p.ms < 100 ? 'primary' : p.ms < 200 ? 'warning' : 'danger'}>
                              → {p.addr} {p.up ? `${p.ms.toFixed(0)}ms` : '不可达'}
                            </Chip>
                          ))}
                        </div>
                      )}
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
              <ModalHeader>{isEdit ? '编辑组网' : '新建组网'}</ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <Input
                    label="组网名称"
                    placeholder="如: 华东组网"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    errorMessage={errors.name}
                    isInvalid={!!errors.name}
                    variant="bordered"
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Input
                      label="网段"
                      placeholder="10.10.0.0/24"
                      value={form.subnet}
                      onChange={e => setForm({ ...form, subnet: e.target.value })}
                      errorMessage={errors.subnet}
                      isInvalid={!!errors.subnet}
                      variant="bordered"
                    />
                    <Input
                      label="UDP监听端口"
                      type="number"
                      value={String(form.listenPort)}
                      onChange={e => setForm({ ...form, listenPort: Number(e.target.value) })}
                      errorMessage={errors.listenPort}
                      isInvalid={!!errors.listenPort}
                      variant="bordered"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <RadioGroup
                      label="组网模式"
                      orientation="horizontal"
                      value={form.mode}
                      onValueChange={v => setForm({ ...form, mode: v as 'mesh' | 'hub' })}
                    >
                      <Radio value="mesh">全互联</Radio>
                      <Radio value="hub">中心-分支</Radio>
                    </RadioGroup>
                    <Input
                      label="MTU"
                      type="number"
                      value={String(form.mtu)}
                      onChange={e => setForm({ ...form, mtu: Number(e.target.value) })}
                      variant="bordered"
                    />
                  </div>
                  <Select
                    label="成员节点"
                    selectionMode="multiple"
                    placeholder="选择加入组网的节点"
                    selectedKeys={new Set(form.nodeIds.map(String))}
                    onSelectionChange={keys => setForm({ ...form, nodeIds: Array.from(keys).map(Number) })}
                    errorMessage={errors.nodeIds}
                    isInvalid={!!errors.nodeIds}
                    variant="bordered"
                  >
                    {nodeOptions.map(node => (
                      <SelectItem key={String(node.id)} textValue={node.name}>
                        {node.name} {node.status === 1 ? '(在线)' : '(离线)'}
                      </SelectItem>
                    ))}
                  </Select>
                  {isEdit && (
                    <p className="text-xs text-default-400">编辑时节点离线将保留成员记录, 待节点上线后点击"同步"重新下发</p>
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
          <ModalHeader>删除组网</ModalHeader>
          <ModalBody>
            确定删除组网 <b>{deleteTarget?.name}</b> 吗? 将移除所有节点的组网接口。
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

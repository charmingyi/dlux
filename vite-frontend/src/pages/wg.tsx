import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import { Radio, RadioGroup } from "@heroui/radio";
import { Select, SelectItem } from "@heroui/select";
import toast from "react-hot-toast";

import {
  createWgNetwork,
  deleteWgNetwork,
  getNodeList,
  getWgNetworkList,
  getWgNetworkStatus,
  syncWgNetwork,
  updateWgNetwork,
} from "@/api";
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

const formatBytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
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
  const [form, setForm] = useState<WgForm>(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadStatuses = async (networks: WgNetwork[], quiet = false) => {
    if (!networks.length) return;
    if (!quiet) setStatusLoading(true);
    try {
      const settled = await Promise.allSettled(networks.map(network => getWgNetworkStatus(network.id)));
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
      // 页面仍可展示已有组网。
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
    networkList.forEach(network => {
      members += network.members.length;
      const status = runtimeMap[network.id];
      healthy += status?.members.filter(member => member.ok).length || 0;
      status?.members.forEach(member => {
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
      nodeIds: network.members.map(member => member.nodeId),
      hubNodeId: network.members.find(member => member.hub === 1)?.nodeId || null,
    });
    setIsEdit(true);
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const nextErrors: Record<string, string> = {};
    if (!form.name.trim()) nextErrors.name = "请输入组网名称";
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(form.subnet)) {
      nextErrors.subnet = "网段格式错误，如 10.10.0.0/24";
    }
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
        members: form.nodeIds.map(nodeId => ({ nodeId, hub: form.mode === "hub" && nodeId === form.hubNodeId ? 1 : 0 })),
      };
      const res = isEdit
        ? await updateWgNetwork({ id: form.id, ...payload })
        : await createWgNetwork(payload);
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
    runtimeMap[networkId]?.members.find(member => member.nodeId === nodeId);

  const peerName = (network: WgNetwork, publicKey: string) =>
    network.members.find(member => member.publicKey === publicKey)?.nodeName || "未知对端";

  const expectedPeerCount = (network: WgNetwork, member: WgMemberRuntime) => {
    if (network.mode === "mesh" || member.hub) return Math.max(0, network.members.length - 1);
    return network.members.length > 1 ? 1 : 0;
  };

  return (
    <div className="p-4 lg:p-6 space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold">WireGuard 组网工作台</h2>
          <p className="text-sm text-default-500 mt-1">先确认真实握手，再把组网作为转发线路的内网底座。</p>
        </div>
        <div className="flex gap-2">
          <Button variant="flat" isLoading={statusLoading} onPress={() => loadStatuses(networkList)}>刷新运行状态</Button>
          <Button color="primary" onPress={openCreate}>新建组网</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><CardBody><p className="text-xs text-default-500">组网</p><p className="text-2xl font-semibold">{networkList.length}</p></CardBody></Card>
        <Card><CardBody><p className="text-xs text-default-500">接口在线</p><p className="text-2xl font-semibold">{totals.healthy}<span className="text-sm text-default-400"> / {totals.members}</span></p></CardBody></Card>
        <Card><CardBody><p className="text-xs text-default-500">3 分钟内握手</p><p className="text-2xl font-semibold">{totals.freshPeers}</p></CardBody></Card>
      </div>

      <Card className="border border-primary-200 bg-primary-50/40 dark:bg-primary-950/10">
        <CardBody className="gap-2 text-sm">
          <div className="font-semibold">利群中转建议</div>
          <div className="text-default-600 grid gap-1 md:grid-cols-3">
            <span>① 优先原生 UDP WireGuard，常规 MTU 1420</span>
            <span>② UDP 受干扰再使用 WSS 外层，MTU 预设 1280</span>
            <span>③ 双 CN2/9929 或双 IPv6 必须先保证源策略路由正确</span>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex justify-center py-20"><Spinner size="lg" /></div>
      ) : networkList.length === 0 ? (
        <Card><CardBody className="text-center py-16 text-default-500">还没有组网。创建后会自动准备密钥、下发 peer，并显示真实握手状态。</CardBody></Card>
      ) : (
        <div className="space-y-4">
          {networkList.map(network => {
            const status = runtimeMap[network.id];
            const okCount = status?.members.filter(member => member.ok).length || 0;
            return (
              <Card key={network.id}>
                <CardHeader className="flex flex-col items-start gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold">{network.name}</span>
                    <Chip size="sm" color="primary" variant="flat">{network.mode === "mesh" ? "Mesh 全互联" : "Hub 中心-分支"}</Chip>
                    <Chip size="sm" color={okCount === network.members.length ? "success" : okCount ? "warning" : "danger"} variant="dot">
                      {okCount}/{network.members.length} 接口在线
                    </Chip>
                    <span className="text-xs text-default-400 font-mono">{network.subnet} · UDP {network.listenPort} · MTU {network.mtu}</span>
                  </div>
                  <div className="flex gap-1">
                    <Button size="sm" color="primary" variant="flat" onPress={() => handleSync(network)}>增量同步</Button>
                    <Button size="sm" variant="light" onPress={() => openEdit(network)}>编辑</Button>
                    <Button size="sm" variant="light" color="danger" onPress={() => setDeleteTarget(network)}>删除</Button>
                  </div>
                </CardHeader>
                <CardBody className="pt-0">
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {network.members.map(member => {
                      const runtimeMember = memberRuntime(network.id, member.nodeId);
                      const runtime = runtimeMember?.runtime;
                      const expected = runtimeMember ? expectedPeerCount(network, runtimeMember) : 0;
                      const fresh = runtime?.peers.filter(isFreshHandshake).length || 0;
                      const error = runtimeMember?.error || (!runtime?.exists ? "接口不存在，请同步" : !runtime?.up ? "接口未启用" : "");
                      return (
                        <div key={member.id} className="rounded-xl border border-default-200 p-3 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Chip size="sm" color={runtimeMember?.ok ? "success" : "danger"} variant="dot">{member.nodeName}</Chip>
                              {member.hub === 1 && <Chip size="sm" color="warning" variant="flat">中心 / 转发节点</Chip>}
                              <span className="font-mono text-xs">{member.ip}</span>
                            </div>
                            <div className="text-xs text-default-500">
                              {runtime ? `${runtime.interface} · MTU ${runtime.mtu || "-"} · peer ${runtime.peers.length}/${expected}` : error || "正在读取"}
                            </div>
                          </div>

                          {error ? (
                            <div className="rounded-lg bg-danger-50 dark:bg-danger-950/20 px-3 py-2 text-xs text-danger">{error}</div>
                          ) : runtime && (
                            <div className="space-y-2">
                              {runtime.peers.length === 0 ? (
                                <div className="text-xs text-warning">接口已创建，但还没有 peer。请确认其他成员已上报公钥后重新同步。</div>
                              ) : runtime.peers.map(peer => (
                                <div key={peer.publicKey} className="rounded-lg bg-default-100/70 px-3 py-2 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="font-medium">→ {peerName(network, peer.publicKey)}</div>
                                    <Chip size="sm" color={isFreshHandshake(peer) ? "success" : "danger"} variant="flat">
                                      {handshakeLabel(peer.latestHandshake)}
                                    </Chip>
                                  </div>
                                  <div className="mt-1 grid gap-1 text-default-500 sm:grid-cols-3">
                                    <span className="truncate" title={peer.endpoint || "动态学习"}>端点 {peer.endpoint || "动态学习"}</span>
                                    <span>路由 {peer.allowedIps.join(", ") || "-"}</span>
                                    <span>↓ {formatBytes(peer.rxBytes)} · ↑ {formatBytes(peer.txBytes)}</span>
                                  </div>
                                </div>
                              ))}
                              <div className="flex flex-wrap gap-1.5">
                                {member.latencies && Object.values(member.latencies).map((probe: any) => (
                                  <Chip key={probe.key} size="sm" variant="flat" color={!probe.up ? "danger" : probe.ms < 80 ? "success" : probe.ms < 180 ? "warning" : "danger"}>
                                    {probe.addr} · {probe.up ? `${probe.ms.toFixed(0)} ms` : "不可达"}
                                  </Chip>
                                ))}
                                {runtime && expected > 0 && <span className="text-xs text-default-400 self-center">新鲜握手 {fresh}/{expected}</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <Modal isOpen={dialogOpen} onOpenChange={setDialogOpen} size="3xl" backdrop="blur" placement="center" scrollBehavior="inside">
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader>{isEdit ? "编辑 WireGuard 组网" : "创建 WireGuard 组网"}</ModalHeader>
              <ModalBody>
                <div className="space-y-5">
                  <div className="rounded-xl bg-default-100 p-3 text-xs text-default-600">
                    Mesh 适合 2-5 个节点直接互联；Hub 适合以利群主机为中转中心，分支只主动连接中心，中心自动启用 IPv4 转发。
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="组网名称" placeholder="如：利群-香港落地" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} errorMessage={errors.name} isInvalid={!!errors.name} variant="bordered" />
                    <Input label="组网网段" placeholder="10.10.0.0/24" value={form.subnet} onChange={event => setForm({ ...form, subnet: event.target.value })} errorMessage={errors.subnet} isInvalid={!!errors.subnet} variant="bordered" />
                  </div>

                  <RadioGroup label="拓扑模式" orientation="horizontal" value={form.mode} onValueChange={value => setForm({ ...form, mode: value as "mesh" | "hub", hubNodeId: value === "hub" ? (form.hubNodeId || form.nodeIds[0] || null) : null })}>
                    <Radio value="mesh">Mesh 全互联</Radio>
                    <Radio value="hub">Hub 中心-分支</Radio>
                  </RadioGroup>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="UDP 监听端口" type="number" value={String(form.listenPort)} onChange={event => setForm({ ...form, listenPort: Number(event.target.value) })} errorMessage={errors.listenPort} isInvalid={!!errors.listenPort} variant="bordered" />
                    <Input label="MTU" type="number" value={String(form.mtu)} onChange={event => setForm({ ...form, mtu: Number(event.target.value) })} errorMessage={errors.mtu} isInvalid={!!errors.mtu} description="原生 UDP 通常 1420；WSS/复杂链路建议从 1280 起测" variant="bordered" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant={form.mtu === 1420 ? "solid" : "flat"} color={form.mtu === 1420 ? "primary" : "default"} onPress={() => setForm({ ...form, mtu: 1420 })}>原生 UDP · MTU 1420</Button>
                    <Button size="sm" variant={form.mtu === 1280 ? "solid" : "flat"} color={form.mtu === 1280 ? "warning" : "default"} onPress={() => setForm({ ...form, mtu: 1280 })}>受限/WSS 链路 · MTU 1280</Button>
                  </div>

                  <Select label="成员节点" selectionMode="multiple" placeholder="选择至少两个节点" selectedKeys={new Set(form.nodeIds.map(String))} onSelectionChange={keys => {
                    const nodeIds = Array.from(keys).map(Number);
                    setForm({ ...form, nodeIds, hubNodeId: form.mode === "hub" && !nodeIds.includes(form.hubNodeId || -1) ? (nodeIds[0] || null) : form.hubNodeId });
                  }} errorMessage={errors.nodeIds} isInvalid={!!errors.nodeIds} variant="bordered">
                    {nodeOptions.map(node => <SelectItem key={String(node.id)} textValue={node.name}>{node.name} · {node.serverIp || "未设置端点"} · {node.status === 1 ? "在线" : "离线（可预配置）"}</SelectItem>)}
                  </Select>

                  {form.mode === "hub" && (
                    <Select label="中心节点" placeholder="选择利群中转节点" selectedKeys={form.hubNodeId != null ? new Set([String(form.hubNodeId)]) : new Set()} onSelectionChange={keys => {
                      const values = Array.from(keys);
                      setForm({ ...form, hubNodeId: values.length ? Number(values[0]) : null });
                    }} errorMessage={errors.hubNodeId} isInvalid={!!errors.hubNodeId} variant="bordered">
                      {nodeOptions.filter(node => form.nodeIds.includes(node.id)).map(node => <SelectItem key={String(node.id)} textValue={node.name}>{node.name} · {node.serverIp}</SelectItem>)}
                    </Select>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>取消</Button>
                <Button color="primary" isLoading={submitLoading} onPress={handleSubmit}>{isEdit ? "保存并增量同步" : "创建并同步"}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal isOpen={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)} size="sm">
        <ModalContent>
          <ModalHeader>删除组网</ModalHeader>
          <ModalBody>确定删除 <b>{deleteTarget?.name}</b> 吗？节点侧对应接口会被移除；正在被线路使用时后端会拒绝删除。</ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setDeleteTarget(null)}>取消</Button>
            <Button color="danger" isLoading={deleteLoading} onPress={handleDelete}>删除</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

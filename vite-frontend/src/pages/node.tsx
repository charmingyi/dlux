import { useState, useEffect, useCallback } from "react";
import toast from "react-hot-toast";
import clsx from "clsx";

import {
  Button,
  Input,
  Textarea,
  Select,
  Modal,
  ConfirmModal,
  Badge,
  StatusDot,
  Card,
  EmptyState,
  PageLoading,
  PageHeader,
  Switch,
  CopyButton,
  MetaItem,
} from "@/components/ui";
import { IconPlus, IconServer, IconTerminal } from "@/components/icons";
import {
  createNode,
  getNodeList,
  updateNode,
  deleteNode,
  getNodeInstallCommand,
  updateNodeAgent,
  getWgNetworkList,
  updateWgNetwork,
} from "@/api";
import { subscribePanelWs } from "@/api/ws";
import { formatBytes, formatSpeed, formatUptime, formatLatency, latencyTone } from "@/utils/format";
import type { Node as NodeType, WgNetwork } from "@/types";

interface NodeForm {
  id: number | null;
  name: string;
  ipString: string;
  serverIp: string;
  portSta: number;
  portEnd: number;
  http: number;
  tls: number;
  socks: number;
}

const defaultForm: NodeForm = {
  id: null,
  name: "",
  ipString: "",
  serverIp: "",
  portSta: 1000,
  portEnd: 65535,
  http: 0,
  tls: 0,
  socks: 0,
};

interface SystemInfo {
  cpuUsage: number;
  memoryUsage: number;
  uploadTraffic: number;
  downloadTraffic: number;
  uploadSpeed: number;
  downloadSpeed: number;
  uptime: number;
}

interface LiveNode extends NodeType {
  systemInfo: SystemInfo | null;
}

const validateIp = (ip: string): boolean => {
  if (!ip || !ip.trim()) return false;
  const trimmedIp = ip.trim();
  const ipv4Regex =
    /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  const ipv6Regex =
    /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  if (ipv4Regex.test(trimmedIp) || ipv6Regex.test(trimmedIp) || trimmedIp === "localhost") return true;
  if (/^\d+$/.test(trimmedIp)) return false;
  const domainRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  const singleLabelDomain = /^[a-zA-Z][a-zA-Z0-9-]{0,62}$/;
  return domainRegex.test(trimmedIp) || singleLabelDomain.test(trimmedIp);
};

/** 进度条 */
const Meter: React.FC<{ value: number; online: boolean }> = ({ value, online }) => {
  const tone = !online ? "bg-line-strong" : value <= 50 ? "bg-success" : value <= 80 ? "bg-warning" : "bg-danger";
  return (
    <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
      <div className={clsx("h-full rounded-full transition-all duration-500", tone)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
};

export default function NodePage() {
  const [nodeList, setNodeList] = useState<LiveNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LiveNode | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [form, setForm] = useState<NodeForm>(defaultForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [installCmd, setInstallCmd] = useState<string | null>(null);
  const [installNodeName, setInstallNodeName] = useState("");
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  // 组网快速加入
  const [wgNetworks, setWgNetworks] = useState<WgNetwork[]>([]);
  const [joinTarget, setJoinTarget] = useState<LiveNode | null>(null);
  const [joinWgId, setJoinWgId] = useState<string>("");
  const [joinLoading, setJoinLoading] = useState(false);

  const loadWgNetworks = useCallback(async () => {
    try {
      const res = await getWgNetworkList();
      if (res.code === 0) setWgNetworks(res.data || []);
    } catch {
      // 静默
    }
  }, []);

  const loadNodes = useCallback(async () => {
    try {
      const res = await getNodeList();
      if (res.code === 0) {
        setNodeList((prev) =>
          (res.data || []).map((node: NodeType) => ({
            ...node,
            systemInfo: prev.find((p) => p.id === node.id)?.systemInfo ?? null,
          }))
        );
      } else {
        toast.error(res.msg || "加载节点列表失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadNodes();
    loadWgNetworks();
    const unsubscribe = subscribePanelWs((msg) => {
      // 后端推送的 id 是字符串, 统一转数字再比较
      const msgId = msg.id != null ? Number(msg.id) : null;
      if (msgId == null || Number.isNaN(msgId)) return;
      if (msg.type === "status") {
        const online = Number(msg.data) === 1;
        setNodeList((prev) =>
          prev.map((n) => (n.id === msgId ? { ...n, status: online ? 1 : 0, systemInfo: online ? n.systemInfo : null } : n))
        );
      } else if (msg.type === "latency") {
        setNodeList((prev) => prev.map((n) => (n.id === msgId ? { ...n, latency: Number(msg.data) } : n)));
      } else if (msg.type === "info") {
        setNodeList((prev) =>
          prev.map((node) => {
            if (node.id !== msgId) return node;
            try {
              const raw = typeof msg.data === "string" ? JSON.parse(msg.data) : msg.data;
              const currentUpload = parseInt(raw.bytes_transmitted) || 0;
              const currentDownload = parseInt(raw.bytes_received) || 0;
              const currentUptime = parseInt(raw.uptime) || 0;

              let uploadSpeed = 0;
              let downloadSpeed = 0;
              if (node.systemInfo?.uptime) {
                const timeDiff = currentUptime - node.systemInfo.uptime;
                if (timeDiff > 0 && timeDiff <= 10) {
                  const lastUpload = node.systemInfo.uploadTraffic || 0;
                  const lastDownload = node.systemInfo.downloadTraffic || 0;
                  if (currentUpload >= lastUpload) uploadSpeed = (currentUpload - lastUpload) / timeDiff;
                  if (currentDownload >= lastDownload) downloadSpeed = (currentDownload - lastDownload) / timeDiff;
                }
              }
              return {
                ...node,
                status: 1,
                systemInfo: {
                  cpuUsage: parseFloat(raw.cpu_usage) || 0,
                  memoryUsage: parseFloat(raw.memory_usage) || 0,
                  uploadTraffic: currentUpload,
                  downloadTraffic: currentDownload,
                  uploadSpeed,
                  downloadSpeed,
                  uptime: currentUptime,
                },
              };
            } catch {
              return node;
            }
          })
        );
      }
    });
    return unsubscribe;
  }, [loadNodes, loadWgNetworks]);

  const setBusy = (id: number, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });

  const openAdd = () => {
    setForm(defaultForm);
    setIsEdit(false);
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (node: LiveNode) => {
    setForm({
      id: node.id,
      name: node.name,
      ipString: node.ip ? node.ip.split(",").map((ip) => ip.trim()).join("\n") : "",
      serverIp: node.serverIp || "",
      portSta: node.portSta,
      portEnd: node.portEnd,
      http: typeof node.http === "number" ? node.http : 1,
      tls: typeof node.tls === "number" ? node.tls : 1,
      socks: typeof node.socks === "number" ? node.socks : 1,
    });
    setIsEdit(true);
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = "请输入节点名称";
    else if (form.name.trim().length < 2) newErrors.name = "节点名称长度至少2位";
    else if (form.name.trim().length > 50) newErrors.name = "节点名称长度不能超过50位";

    if (!form.ipString.trim()) {
      newErrors.ipString = "请输入入口IP地址";
    } else {
      const ips = form.ipString.split("\n").map((ip) => ip.trim()).filter(Boolean);
      if (ips.length === 0) newErrors.ipString = "请输入至少一个有效IP地址";
      else
        for (let i = 0; i < ips.length; i++) {
          if (!validateIp(ips[i])) {
            newErrors.ipString = `第${i + 1}行IP地址格式错误: ${ips[i]}`;
            break;
          }
        }
    }

    if (!form.serverIp.trim()) newErrors.serverIp = "请输入服务器IP地址";
    else if (!validateIp(form.serverIp.trim())) newErrors.serverIp = "请输入有效的IPv4、IPv6地址或域名";

    if (!form.portSta || form.portSta < 1 || form.portSta > 65535) newErrors.portSta = "端口范围必须在1-65535之间";
    if (!form.portEnd || form.portEnd < 1 || form.portEnd > 65535) newErrors.portEnd = "端口范围必须在1-65535之间";
    else if (form.portEnd < form.portSta) newErrors.portEnd = "结束端口不能小于起始端口";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitLoading(true);
    try {
      const ipString = form.ipString
        .split("\n")
        .map((ip) => ip.trim())
        .filter(Boolean)
        .join(",");
      const data = {
        id: form.id,
        name: form.name,
        ip: ipString,
        serverIp: form.serverIp,
        portSta: form.portSta,
        portEnd: form.portEnd,
        http: form.http,
        tls: form.tls,
        socks: form.socks,
      };
      const res = isEdit ? await updateNode(data) : await createNode(data);
      if (res.code === 0) {
        toast.success(isEdit ? "更新成功" : "创建成功，请在节点上执行安装命令");
        setDialogOpen(false);
        loadNodes();
      } else {
        toast.error(res.msg || (isEdit ? "更新失败" : "创建失败"));
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setSubmitLoading(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await deleteNode(deleteTarget.id);
      if (res.code === 0) {
        toast.success("删除成功");
        setDeleteTarget(null);
        loadNodes();
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleInstall = async (node: LiveNode) => {
    setBusy(node.id, true);
    try {
      const res = await getNodeInstallCommand(node.id);
      if (res.code === 0 && res.data) {
        setInstallCmd(res.data);
        setInstallNodeName(node.name);
      } else {
        toast.error(res.msg || "获取安装命令失败");
      }
    } catch {
      toast.error("获取安装命令失败");
    } finally {
      setBusy(node.id, false);
    }
  };

  const handleUpdateAgent = async (node: LiveNode) => {
    setBusy(node.id, true);
    try {
      const res = await updateNodeAgent(node.id);
      if (res.code === 0) toast.success(res.msg || "更新指令已下发");
      else toast.error(res.msg || "更新失败");
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setBusy(node.id, false);
    }
  };

  const nodeNetworks = (nodeId: number) => wgNetworks.filter((w) => w.members?.some((m) => m.nodeId === nodeId));

  const handleJoinWg = async () => {
    if (!joinTarget || !joinWgId) return;
    const wg = wgNetworks.find((w) => w.id === Number(joinWgId));
    if (!wg) return;
    setJoinLoading(true);
    try {
      const members = [
        ...(wg.members || []).map((m) => ({ nodeId: m.nodeId, hub: m.hub })),
        { nodeId: joinTarget.id, hub: 0 },
      ];
      const res = await updateWgNetwork({
        id: wg.id,
        name: wg.name,
        subnet: wg.subnet,
        mode: wg.mode,
        listenPort: wg.listenPort,
        mtu: wg.mtu,
        members,
      });
      if (res.code === 0) {
        toast.success(`已将 ${joinTarget.name} 加入「${wg.name}」并同步`);
        setJoinTarget(null);
        setJoinWgId("");
        loadWgNetworks();
      } else {
        toast.error(res.msg || "加入组网失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setJoinLoading(false);
    }
  };

  const editingNode = isEdit ? nodeList.find((n) => n.id === form.id) : null;
  const protocolLocked = isEdit && editingNode ? editingNode.status !== 1 : true;

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader title="节点监控" description="服务器接入与实时资源监控">
        <Button variant="primary" onClick={openAdd}>
          <IconPlus size={14} /> 新增节点
        </Button>
      </PageHeader>

      {loading ? (
        <PageLoading />
      ) : nodeList.length === 0 ? (
        <Card>
          <EmptyState
            title="暂无节点"
            description="添加节点后复制安装命令到服务器执行，Agent 会自动连回面板"
            icon={<IconServer size={22} />}
            action={
              <Button variant="primary" onClick={openAdd}>
                <IconPlus size={14} /> 新增节点
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
          {nodeList.map((node) => {
            const online = node.status === 1;
            const si = node.systemInfo;
            return (
              <Card key={node.id} className="space-y-3.5">
                {/* 标题 */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <StatusDot tone={online ? "success" : "danger"} pulse={online} />
                      <h3 className="font-semibold text-fg truncate text-[14px]">{node.name}</h3>
                    </div>
                    <p className="mt-0.5 text-[11px] text-faint font-mono truncate">{node.serverIp}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {online && node.latency != null && (
                      <Badge tone={latencyTone(node.latency)}>{formatLatency(node.latency)}</Badge>
                    )}
                    <Badge tone={online ? "success" : "danger"}>{online ? "在线" : "离线"}</Badge>
                  </div>
                </div>

                {/* 基础信息 */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <MetaItem label="入口IP">
                    <span className="font-mono">
                      {node.ip ? (
                        node.ip.split(",").length > 1 ? (
                          `${node.ip.split(",")[0].trim()} +${node.ip.split(",").length - 1}`
                        ) : (
                          node.ip.trim()
                        )
                      ) : "-"}
                    </span>
                  </MetaItem>
                  <MetaItem label="端口范围">
                    <span className="font-mono tnum">
                      {node.portSta}-{node.portEnd}
                    </span>
                  </MetaItem>
                  <MetaItem label="Agent 版本">{node.version || "未知"}</MetaItem>
                  <MetaItem label="开机时间">{online && si ? formatUptime(si.uptime) : "-"}</MetaItem>
                  <MetaItem label="所属组网" className="col-span-2">
                    {nodeNetworks(node.id).length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {nodeNetworks(node.id).map((w) => (
                          <Badge key={w.id} tone="accent">
                            {w.name}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <button
                        className="text-accent text-xs hover:underline"
                        onClick={() => {
                          setJoinTarget(node);
                          setJoinWgId(wgNetworks[0] ? String(wgNetworks[0].id) : "");
                        }}
                      >
                        未加入组网，点击加入 →
                      </button>
                    )}
                  </MetaItem>
                </div>

                {/* 监控 */}
                <div className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between text-[11px] mb-1">
                        <span className="text-muted">CPU</span>
                        <span className="font-mono tnum text-fg">{si ? `${si.cpuUsage.toFixed(1)}%` : "-"}</span>
                      </div>
                      <Meter value={si?.cpuUsage ?? 0} online={online && !!si} />
                    </div>
                    <div>
                      <div className="flex justify-between text-[11px] mb-1">
                        <span className="text-muted">内存</span>
                        <span className="font-mono tnum text-fg">{si ? `${si.memoryUsage.toFixed(1)}%` : "-"}</span>
                      </div>
                      <Meter value={si?.memoryUsage ?? 0} online={online && !!si} />
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5 text-center">
                    {[
                      { label: "↓ 速率", value: si ? formatSpeed(si.downloadSpeed) : "-" },
                      { label: "↑ 速率", value: si ? formatSpeed(si.uploadSpeed) : "-" },
                      { label: "↓ 累计", value: si ? formatBytes(si.downloadTraffic) : "-" },
                      { label: "↑ 累计", value: si ? formatBytes(si.uploadTraffic) : "-" },
                    ].map((item) => (
                      <div key={item.label} className="bg-surface-2 rounded-lg py-1.5">
                        <div className="text-[10px] text-faint">{item.label}</div>
                        <div className="text-[11px] font-mono tnum text-fg mt-0.5">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 操作 */}
                <div className="flex gap-1.5 pt-0.5 border-t border-line/60">
                  <Button size="xs" className="flex-1" onClick={() => handleInstall(node)} loading={busyIds.has(node.id)}>
                    <IconTerminal size={12} /> 安装
                  </Button>
                  {online && (
                    <Button size="xs" className="flex-1" onClick={() => handleUpdateAgent(node)} loading={busyIds.has(node.id)}>
                      升级
                    </Button>
                  )}
                  <Button size="xs" className="flex-1" onClick={() => openEdit(node)}>
                    编辑
                  </Button>
                  <Button size="xs" variant="danger" className="flex-1" onClick={() => setDeleteTarget(node)}>
                    删除
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* 新增/编辑弹窗 */}
      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={isEdit ? "编辑节点" : "新增节点"}
        width="max-w-2xl"
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)}>取消</Button>
            <Button variant="primary" onClick={handleSubmit} loading={submitLoading}>
              确定
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="节点名称"
              placeholder="如：利群-香港中转"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              error={errors.name}
            />
            <Input
              label="服务器IP / 域名"
              placeholder="服务器真实地址, 如 192.168.1.100"
              value={form.serverIp}
              onChange={(e) => setForm({ ...form, serverIp: e.target.value })}
              error={errors.serverIp}
              mono
            />
          </div>

          <Textarea
            label="入口IP（一行一个）"
            placeholder={"面向用户的访问地址, 如:\nlqcuv6.example.com\n2001:db8::1"}
            value={form.ipString}
            onChange={(e) => setForm({ ...form, ipString: e.target.value })}
            error={errors.ipString}
            hint="展示在转发页面；没有多入口需求时填服务器IP即可"
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="起始端口"
              type="number"
              value={String(form.portSta)}
              onChange={(e) => setForm({ ...form, portSta: parseInt(e.target.value) || 1000 })}
              error={errors.portSta}
              mono
            />
            <Input
              label="结束端口"
              type="number"
              value={String(form.portEnd)}
              onChange={(e) => setForm({ ...form, portEnd: parseInt(e.target.value) || 65535 })}
              error={errors.portEnd}
              mono
            />
          </div>

          {/* 屏蔽协议 */}
          <div>
            <div className="text-[13px] font-medium text-fg mb-1">屏蔽协议</div>
            <div className="text-xs text-faint mb-2">开启表示屏蔽对应协议，仅在入口节点使用</div>
            {protocolLocked && (
              <div className="mb-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                {isEdit ? "节点未在线，等待节点上线后再设置" : "节点创建并上线后可设置"}
              </div>
            )}
            <div className="grid grid-cols-3 gap-2.5">
              {(
                [
                  { key: "http", label: "HTTP" },
                  { key: "tls", label: "TLS" },
                  { key: "socks", label: "SOCKS" },
                ] as const
              ).map((p) => (
                <div
                  key={p.key}
                  className={clsx(
                    "flex items-center justify-between px-3 py-2.5 rounded-lg border bg-surface transition-colors",
                    protocolLocked ? "opacity-60 border-line" : "border-line hover:border-line-strong"
                  )}
                >
                  <span className="text-[13px] font-medium text-fg">{p.label}</span>
                  <Switch
                    size="sm"
                    checked={form[p.key] === 1}
                    disabled={protocolLocked}
                    onChange={(v) => setForm({ ...form, [p.key]: v ? 1 : 0 })}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger leading-relaxed">
            不要在出口节点屏蔽协议，否则可能影响转发；屏蔽协议仅需在入口节点执行。
          </div>
        </div>
      </Modal>

      {/* 删除确认 */}
      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        loading={deleteLoading}
        title="删除节点"
        message={
          <>
            确定删除节点 <b className="text-fg">{deleteTarget?.name}</b> 吗？此操作不可恢复。
          </>
        }
      />

      {/* 加入组网 */}
      <Modal
        open={!!joinTarget}
        onClose={() => setJoinTarget(null)}
        title={`将 ${joinTarget?.name ?? ""} 加入组网`}
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => setJoinTarget(null)}>取消</Button>
            <Button variant="primary" onClick={handleJoinWg} loading={joinLoading} disabled={!joinWgId}>
              加入并同步
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select label="选择组网" value={joinWgId} onChange={(e) => setJoinWgId(e.target.value)}>
            <option value="">选择组网</option>
            {wgNetworks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {w.mode} · {w.members?.length || 0} 节点
              </option>
            ))}
          </Select>
          <p className="text-xs text-faint leading-relaxed">
            加入后面板会立即增量同步 WireGuard 配置（准备密钥 + 下发对端），随后即可在转发快速创建中使用该节点。
          </p>
          {wgNetworks.length === 0 && (
            <p className="text-xs text-warning">还没有组网。可先在「WireGuard 组网」创建，或在转发页用快速创建自动建网。</p>
          )}
        </div>
      </Modal>

      {/* 安装命令 */}
      <Modal
        open={installCmd != null}
        onClose={() => setInstallCmd(null)}
        title={`安装命令 - ${installNodeName}`}
        width="max-w-2xl"
        footer={<Button onClick={() => setInstallCmd(null)}>关闭</Button>}
      >
        <p className="text-xs text-muted mb-3">复制以下命令到服务器 root 执行，Agent 会自动连回面板：</p>
        <div className="relative">
          <pre className="bg-surface-2 border border-line rounded-xl p-3.5 pr-16 text-xs font-mono text-fg whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
            {installCmd ?? ""}
          </pre>
          <div className="absolute top-2.5 right-2.5">
            <CopyButton text={installCmd ?? ""} />
          </div>
        </div>
      </Modal>
    </div>
  );
}

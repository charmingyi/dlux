import { useState, useEffect } from "react";
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
  EmptyState,
  PageLoading,
  PageHeader,
  SegmentedControl,
} from "@/components/ui";
import { IconPlus, IconRefresh, IconChevronRight } from "@/components/icons";
import { createLink, getLinkList, updateLink, deleteLink, redeployLink, getWgNetworkList, getNodeList } from "@/api";
import { formatLatency, latencyTone, transportLabel } from "@/utils/format";
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
  transport: "wg" | "tls" | "tcp";
  entryNodeId: number | null;
  exitNodeId: number | null;
  hopNodeIds: number[];
}

const defaultForm: LinkForm = {
  id: null,
  name: "",
  wgNetworkId: null,
  transport: "wg",
  entryNodeId: null,
  exitNodeId: null,
  hopNodeIds: [],
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
    try {
      const res = await getLinkList();
      if (res.code === 0) setLinkList(res.data || []);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  };

  const loadOptions = async () => {
    try {
      const [nodeRes, wgRes] = await Promise.all([getNodeList(), getWgNetworkList()]);
      if (nodeRes.code === 0) setNodeOptions(nodeRes.data || []);
      if (wgRes.code === 0) setWgOptions(wgRes.data || []);
    } catch {
      // 静默
    }
  };

  useEffect(() => {
    setLoading(true);
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

  const parseHops = (raw?: string): number[] => {
    try {
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  };

  const openEdit = (link: LinkItem) => {
    setForm({
      id: link.id,
      name: link.name,
      wgNetworkId: link.wgNetworkId ?? null,
      transport: link.transport,
      entryNodeId: link.entryNodeId,
      exitNodeId: link.exitNodeId,
      hopNodeIds: parseHops(link.hopNodeIds),
    });
    setIsEdit(true);
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "请输入线路名称";
    if (form.entryNodeId == null) errs.entryNodeId = "请选择入口节点";
    if (form.exitNodeId == null) errs.exitNodeId = "请选择出口节点";
    if (form.transport === "wg" && form.wgNetworkId == null) errs.wgNetworkId = "组网传输必须选择组网";
    if (form.entryNodeId === form.exitNodeId && form.hopNodeIds.length > 0) {
      errs.hopNodeIds = "直连线路(入口=出口)不能有中间节点";
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
        wgNetworkId: form.transport === "wg" ? form.wgNetworkId : null,
        transport: form.transport,
        entryNodeId: form.entryNodeId,
        exitNodeId: form.exitNodeId,
        hopNodeIds: form.hopNodeIds,
      };
      const res = isEdit ? await updateLink({ id: form.id, ...payload }) : await createLink(payload);
      if (res.code === 0) {
        toast.success(isEdit ? "线路更新成功" : "线路创建成功");
        setDialogOpen(false);
        loadLinks();
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
      const res = await deleteLink(deleteTarget.id);
      if (res.code === 0) {
        toast.success("线路删除成功");
        setDeleteTarget(null);
        loadLinks();
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleRedeploy = async (link: LinkItem) => {
    try {
      const res = await redeployLink(link.id);
      if (res.code === 0) toast.success("线路重新下发成功");
      else toast.error(res.msg || "重新下发失败");
    } catch {
      toast.error("网络错误，请重试");
    }
  };

  const hopNames = (link: LinkItem) => {
    const nameMap = new Map(nodeOptions.map((n) => [n.id, n.name]));
    return parseHops(link.hopNodeIds).map((id) => nameMap.get(id) || `#${id}`);
  };

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader title="线路管理" description="线路 = 入口 → 中间节点 → 出口（落地），可基于组网或公网直连">
        <Button variant="primary" onClick={openCreate}>
          <IconPlus size={14} /> 新建线路
        </Button>
      </PageHeader>

      {loading ? (
        <PageLoading />
      ) : linkList.length === 0 ? (
        <Card>
          <EmptyState
            title="暂无线路"
            description="线路是转发任务的路径单元；也可以直接在「转发管理」里用一体化向导自动创建"
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {linkList.map((link) => {
            const entryOnline = link.entryNodeStatus === 1;
            const exitOnline = link.exitNodeStatus === 1;
            return (
              <Card key={link.id} className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-fg truncate text-[14px]">{link.name}</span>
                    <Badge tone="accent">{transportLabel[link.transport] || link.transport}</Badge>
                    {link.wgNetworkName && <Badge>{link.wgNetworkName}</Badge>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="xs" onClick={() => handleRedeploy(link)}>
                      <IconRefresh size={12} /> 重发
                    </Button>
                    <Button size="xs" onClick={() => openEdit(link)}>
                      编辑
                    </Button>
                    <Button size="xs" variant="danger" onClick={() => setDeleteTarget(link)}>
                      删除
                    </Button>
                  </div>
                </div>

                {/* 路径 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={entryOnline ? "neutral" : "danger"}>
                    <StatusDot tone={entryOnline ? "success" : "danger"} />
                    {link.entryNodeName || `#${link.entryNodeId}`}
                  </Badge>
                  <IconChevronRight size={12} className="text-faint" />
                  {hopNames(link).map((name, i) => (
                    <span key={i} className="flex items-center gap-1.5">
                      <Badge>{name}</Badge>
                      <IconChevronRight size={12} className="text-faint" />
                    </span>
                  ))}
                  <Badge tone={exitOnline ? "neutral" : "danger"}>
                    <StatusDot tone={exitOnline ? "success" : "danger"} />
                    {link.exitNodeName || `#${link.exitNodeId}`}
                  </Badge>
                </div>

                <div className="text-xs text-faint">
                  共 {link.nodeCount || 2} 个节点 · 入口组网IP: <span className="font-mono">{link.entryWgIp || "--"}</span>
                </div>

                {link.latencies && Object.values(link.latencies).length > 0 && (
                  <div className="pt-2 border-t border-line/60">
                    <div className="text-[11px] text-faint mb-1.5">入口 → 各端点延迟</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.values(link.latencies).map((e, i) => (
                        <Badge key={i} tone={e.up ? latencyTone(e.ms) : "danger"}>
                          {e.addr} {e.up ? formatLatency(e.ms) : "不可达"}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={isEdit ? "编辑线路" : "新建线路"}
        width="max-w-xl"
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
          <Input
            label="线路名称"
            placeholder="如: 华东A线"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
          />

          <div>
            <div className="mb-1.5 text-[13px] font-medium text-fg">节点间传输</div>
            <SegmentedControl
              value={form.transport}
              onChange={(v) => setForm({ ...form, transport: v })}
              options={[
                { value: "wg", label: "组网 (WG)" },
                { value: "tls", label: "TLS" },
                { value: "tcp", label: "TCP" },
              ]}
            />
          </div>

          {form.transport === "wg" && (
            <Select
              label="组网"
              value={form.wgNetworkId != null ? String(form.wgNetworkId) : ""}
              onChange={(e) => setForm({ ...form, wgNetworkId: e.target.value ? Number(e.target.value) : null })}
              error={errors.wgNetworkId}
            >
              <option value="">选择组网</option>
              {wgOptions.map((wg) => (
                <option key={wg.id} value={wg.id}>
                  {wg.name}
                </option>
              ))}
            </Select>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Select
              label="入口节点"
              value={form.entryNodeId != null ? String(form.entryNodeId) : ""}
              onChange={(e) => setForm({ ...form, entryNodeId: e.target.value ? Number(e.target.value) : null })}
              error={errors.entryNodeId}
            >
              <option value="">选择入口</option>
              {nodeOptions.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} {node.status === 1 ? "(在线)" : "(离线)"}
                </option>
              ))}
            </Select>
            <Select
              label="出口(落地)节点"
              value={form.exitNodeId != null ? String(form.exitNodeId) : ""}
              onChange={(e) => setForm({ ...form, exitNodeId: e.target.value ? Number(e.target.value) : null })}
              error={errors.exitNodeId}
            >
              <option value="">选择出口</option>
              {nodeOptions.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name} {node.status === 1 ? "(在线)" : "(离线)"}
                </option>
              ))}
            </Select>
          </div>

          {/* 中间节点: 按顺序添加 */}
          <div>
            <div className="text-[12px] text-muted mb-1.5">中间节点（可选，按加入顺序多跳）</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {form.hopNodeIds.map((nodeId, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 px-2 h-7 rounded-md bg-surface-2 border border-line text-xs text-fg"
                >
                  {nodeOptions.find((n) => n.id === nodeId)?.name || `#${nodeId}`}
                  <button
                    className="text-faint hover:text-danger"
                    onClick={() => setForm({ ...form, hopNodeIds: form.hopNodeIds.filter((_, i) => i !== idx) })}
                  >
                    ×
                  </button>
                </span>
              ))}
              <select
                className="h-7 px-2 rounded-md bg-surface-2 border border-line text-xs text-muted outline-none cursor-pointer hover:border-line-strong"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    setForm({ ...form, hopNodeIds: [...form.hopNodeIds, Number(e.target.value)] });
                  }
                }}
              >
                <option value="">+ 添加中间节点</option>
                {nodeOptions
                  .filter((n) => n.id !== form.entryNodeId && n.id !== form.exitNodeId && !form.hopNodeIds.includes(n.id))
                  .map((node) => (
                    <option key={node.id} value={node.id}>
                      {node.name} {node.status === 1 ? "(在线)" : "(离线)"}
                    </option>
                  ))}
              </select>
            </div>
            {errors.hopNodeIds && <p className="mt-1 text-xs text-danger">{errors.hopNodeIds}</p>}
          </div>

          {form.entryNodeId != null && form.entryNodeId === form.exitNodeId && (
            <p className="text-xs text-faint">入口=出口时为直连线路，无需组网</p>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleteLoading}
        title="删除线路"
        message={
          <>
            确定删除线路 <b className="text-fg">{deleteTarget?.name}</b> 吗? 将移除所有中继服务与链配置。
          </>
        }
      />
    </div>
  );
}

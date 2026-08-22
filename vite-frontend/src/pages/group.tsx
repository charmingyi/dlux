import { useState, useEffect } from "react";
import toast from "react-hot-toast";

import {
  Button,
  Input,
  Select,
  Modal,
  ConfirmModal,
  Badge,
  Card,
  EmptyState,
  PageLoading,
  PageHeader,
} from "@/components/ui";
import { IconPlus } from "@/components/icons";
import { createGroup, getGroupList, updateGroup, deleteGroup, getLinkList } from "@/api";
import { strategyLabel, transportLabel } from "@/utils/format";
import type { GroupItem, LinkItem } from "@/types";

const STRATEGIES = [
  { value: "round", label: "轮询 (round)" },
  { value: "random", label: "加权随机 (random)" },
  { value: "fifo", label: "失败切换 (fifo)" },
  { value: "hash", label: "会话哈希 (hash)" },
  { value: "latency", label: "最佳延迟 (latency)" },
];

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
  name: "",
  strategy: "round",
  maxFails: 1,
  failTimeout: "600s",
  linkIds: [],
  weights: [],
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
    try {
      const res = await getGroupList();
      if (res.code === 0) setGroupList(res.data || []);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  };

  const loadLinks = async () => {
    try {
      const res = await getLinkList();
      if (res.code === 0) setLinkOptions(res.data || []);
    } catch {
      // 静默
    }
  };

  useEffect(() => {
    setLoading(true);
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
      failTimeout: group.failTimeout || "600s",
      linkIds: group.links.map((l) => l.linkId),
      weights: group.links.map((l) => l.weight || 1),
    });
    setIsEdit(true);
    setErrors({});
    setDialogOpen(true);
  };

  const validateForm = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "请输入组名称";
    if (!form.linkIds.length) errs.linkIds = "请至少选择一条线路";
    if (form.linkIds.length > 1) {
      const selected = linkOptions.filter((l) => form.linkIds.includes(l.id));
      const entryNodes = new Set(selected.map((l) => l.entryNodeId));
      if (entryNodes.size > 1) errs.linkIds = "组内所有线路必须使用同一入口节点";
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
        weights: form.linkIds.map((_, i) => form.weights[i] || 1),
      };
      const res = isEdit ? await updateGroup({ id: form.id, ...payload }) : await createGroup(payload);
      if (res.code === 0) {
        toast.success(isEdit ? "组更新成功" : "组创建成功");
        setDialogOpen(false);
        loadGroups();
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
      const res = await deleteGroup(deleteTarget.id);
      if (res.code === 0) {
        toast.success("组删除成功");
        setDeleteTarget(null);
        loadGroups();
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeleteLoading(false);
    }
  };

  const toggleLink = (id: number) => {
    const ids = form.linkIds.includes(id) ? form.linkIds.filter((x) => x !== id) : [...form.linkIds, id];
    const weights = ids.map((lid) => {
      const idx = form.linkIds.indexOf(lid);
      return idx >= 0 ? form.weights[idx] || 1 : 1;
    });
    setForm({ ...form, linkIds: ids, weights });
  };

  return (
    <div className="p-4 lg:p-6 max-w-7xl mx-auto">
      <PageHeader title="负载均衡组" description="组内线路共享同一入口节点，按策略选择线路出口">
        <Button variant="primary" onClick={openCreate}>
          <IconPlus size={14} /> 新建组
        </Button>
      </PageHeader>

      {loading ? (
        <PageLoading />
      ) : groupList.length === 0 ? (
        <Card>
          <EmptyState title="暂无负载均衡组" description="一体化创建转发时会自动生成组；也可以在此手动编排" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {groupList.map((group) => (
            <Card key={group.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-fg truncate text-[14px]">{group.name}</span>
                  <Badge tone="accent">{strategyLabel[group.strategy] || group.strategy}</Badge>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="xs" onClick={() => openEdit(group)}>
                    编辑
                  </Button>
                  <Button size="xs" variant="danger" onClick={() => setDeleteTarget(group)}>
                    删除
                  </Button>
                </div>
              </div>

              <div className="flex gap-4 text-xs text-faint">
                <span>
                  线路 <span className="text-fg font-medium tnum">{group.linkCount}</span>
                </span>
                <span>
                  转发 <span className="text-fg font-medium tnum">{group.forwardCount}</span>
                </span>
                {group.maxFails != null && (
                  <span>
                    失败{group.maxFails}次摘除 · {group.failTimeout}恢复
                  </span>
                )}
              </div>

              <div className="space-y-1">
                {group.links.map((link) => (
                  <div
                    key={link.linkId}
                    className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-1.5"
                  >
                    <span className="text-[13px] text-fg truncate">{link.linkName}</span>
                    <div className="flex items-center gap-2 text-[11px] text-faint shrink-0">
                      <Badge>{transportLabel[link.transport] || link.transport}</Badge>
                      {group.strategy === "random" && <span>权重 {link.weight}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 创建/编辑弹窗 */}
      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={isEdit ? "编辑组" : "新建组"}
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
            label="组名称"
            placeholder="如: 华东多线路组"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
          />

          <div className="grid grid-cols-3 gap-3">
            <Select label="均衡策略" value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}>
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <Input
              label="失败次数"
              type="number"
              value={String(form.maxFails)}
              onChange={(e) => setForm({ ...form, maxFails: Number(e.target.value) || 1 })}
              mono
            />
            <Input
              label="恢复时间"
              placeholder="600s"
              value={form.failTimeout}
              onChange={(e) => setForm({ ...form, failTimeout: e.target.value })}
              mono
            />
          </div>

          {/* 线路勾选 */}
          <div>
            <div className="mb-1.5 text-[13px] font-medium text-fg">组内线路（需同一入口节点）</div>
            <div className="space-y-1.5 max-h-52 overflow-y-auto p-1">
              {linkOptions.length === 0 && <div className="text-xs text-faint py-2">暂无可选线路</div>}
              {linkOptions.map((link) => {
                const checked = form.linkIds.includes(link.id);
                return (
                  <label
                    key={link.id}
                    className={`flex items-center gap-2.5 px-3 h-10 rounded-lg border cursor-pointer transition-colors ${
                      checked ? "border-accent/50 bg-accent-soft" : "border-line hover:border-line-strong bg-surface"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)] h-4 w-4"
                      checked={checked}
                      onChange={() => toggleLink(link.id)}
                    />
                    <span className="flex-1 min-w-0 truncate text-[13px] text-fg">{link.name}</span>
                    <span className="text-[11px] text-faint">
                      {link.entryNodeName || `入口#${link.entryNodeId}`} → {link.exitNodeName || `出口#${link.exitNodeId}`}
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.linkIds && <p className="mt-1 text-xs text-danger">{errors.linkIds}</p>}
          </div>

          {form.strategy === "random" && form.linkIds.length > 0 && (
            <div className="space-y-2">
              <div className="text-[12px] text-muted">线路权重（仅加权随机生效）:</div>
              {form.linkIds.map((id, i) => {
                const link = linkOptions.find((l) => l.id === id);
                return (
                  <div key={id} className="flex items-center gap-3">
                    <span className="text-[13px] text-fg flex-1 truncate">{link?.name || `#${id}`}</span>
                    <input
                      className="w-20 h-8 px-2.5 text-[13px] rounded-lg bg-surface border border-line focus:border-accent outline-none font-mono tnum"
                      type="number"
                      min={1}
                      value={String(form.weights[i] || 1)}
                      onChange={(e) => {
                        const weights = [...form.weights];
                        weights[i] = Number(e.target.value) || 1;
                        setForm({ ...form, weights });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}

          <p className="text-xs text-faint leading-relaxed">
            轮询: 依次选择线路 · 失败切换: 固定首选线路，失败后切换 · 最佳延迟: 按节点实测延迟选择最优线路，无数据时回退轮询
          </p>
        </div>
      </Modal>

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleteLoading}
        title="删除组"
        message={
          <>
            确定删除负载均衡组 <b className="text-fg">{deleteTarget?.name}</b> 吗? 使用该组的转发需先删除。
          </>
        }
      />
    </div>
  );
}

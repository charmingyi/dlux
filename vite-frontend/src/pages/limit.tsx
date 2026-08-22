import { useState, useEffect } from "react";
import toast from "react-hot-toast";

import {
  Button,
  Input,
  Modal,
  ConfirmModal,
  Badge,
  Card,
  EmptyState,
  PageLoading,
  PageHeader,
  TableWrap,
  Th,
  Td,
} from "@/components/ui";
import { IconPlus, IconPencil, IconTrash, IconGauge } from "@/components/icons";
import { createSpeedLimit, getSpeedLimitList, updateSpeedLimit, deleteSpeedLimit } from "@/api";
import { formatTime } from "@/utils/format";
import type { SpeedLimit } from "@/types";

interface SpeedLimitForm {
  id?: number;
  name: string;
  speed: number;
  status: number;
}

export default function LimitPage() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<SpeedLimit[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<SpeedLimit | null>(null);
  const [form, setForm] = useState<SpeedLimitForm>({ name: "", speed: 100, status: 1 });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadData = async () => {
    try {
      const res = await getSpeedLimitList();
      if (res.code === 0) setRules(res.data || []);
      else toast.error(res.msg || "获取限速规则失败");
    } catch {
      toast.error("加载数据失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!form.name.trim()) newErrors.name = "请输入规则名称";
    if (!form.speed || form.speed < 1) newErrors.speed = "请输入有效的速度限制（≥1 Mbps）";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAdd = () => {
    setIsEdit(false);
    setForm({ name: "", speed: 100, status: 1 });
    setErrors({});
    setModalOpen(true);
  };

  const handleEdit = (rule: SpeedLimit) => {
    setIsEdit(true);
    setForm({ id: rule.id, name: rule.name, speed: rule.speed, status: rule.status });
    setErrors({});
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitLoading(true);
    try {
      const res = isEdit ? await updateSpeedLimit(form) : await createSpeedLimit(form);
      if (res.code === 0) {
        toast.success(isEdit ? "规则更新成功" : "规则创建成功");
        setModalOpen(false);
        loadData();
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
    if (!ruleToDelete) return;
    setDeleteLoading(true);
    try {
      const res = await deleteSpeedLimit(ruleToDelete.id);
      if (res.code === 0) {
        toast.success("规则删除成功");
        setRuleToDelete(null);
        loadData();
      } else {
        toast.error(res.msg || "删除失败");
      }
    } catch {
      toast.error("网络错误，请重试");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="p-4 lg:p-6 max-w-5xl mx-auto">
      <PageHeader title="限速管理" description="带宽限制规则，在转发任务中绑定生效">
        <Button variant="primary" onClick={handleAdd}>
          <IconPlus size={14} /> 新建规则
        </Button>
      </PageHeader>

      {loading ? (
        <PageLoading />
      ) : rules.length === 0 ? (
        <Card>
          <EmptyState
            title="暂无限速规则"
            description="创建规则后可在转发的编辑面板中绑定"
            icon={<IconGauge size={22} />}
          />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <TableWrap>
            <thead>
              <tr>
                <Th>名称</Th>
                <Th>速度上限</Th>
                <Th>状态</Th>
                <Th>创建时间</Th>
                <Th className="text-right">操作</Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-surface-2/60 transition-colors">
                  <Td>
                    <span className="font-medium text-fg">{rule.name}</span>
                  </Td>
                  <Td>
                    <Badge tone="accent">{rule.speed} Mbps</Badge>
                  </Td>
                  <Td>
                    <Badge tone={rule.status === 1 ? "success" : "warning"}>{rule.status === 1 ? "启用" : "停用"}</Badge>
                  </Td>
                  <Td>
                    <span className="text-xs text-faint">{formatTime(rule.createdTime)}</span>
                  </Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="xs" onClick={() => handleEdit(rule)}>
                        <IconPencil size={12} /> 编辑
                      </Button>
                      <Button size="xs" variant="danger" onClick={() => setRuleToDelete(rule)}>
                        <IconTrash size={12} /> 删除
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={isEdit ? "编辑限速规则" : "新建限速规则"}
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button variant="primary" onClick={handleSubmit} loading={submitLoading}>
              确定
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="规则名称"
            placeholder="如: 100M 限制"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            error={errors.name}
          />
          <Input
            label="速度上限 (Mbps)"
            type="number"
            min={1}
            value={String(form.speed)}
            onChange={(e) => setForm({ ...form, speed: Number(e.target.value) })}
            error={errors.speed}
            mono
          />
        </div>
      </Modal>

      <ConfirmModal
        open={!!ruleToDelete}
        onClose={() => setRuleToDelete(null)}
        onConfirm={handleDelete}
        loading={deleteLoading}
        title="删除规则"
        message={
          <>
            确定删除限速规则 <b className="text-fg">{ruleToDelete?.name}</b> 吗? 正在使用该规则的转发不受影响，但将不再限速。
          </>
        }
      />
    </div>
  );
}

import { useState, useEffect } from "react";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Button } from "@heroui/button";
import { Input } from "@heroui/input";
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@heroui/modal";
import { Chip } from "@heroui/chip";
import { Spinner } from "@heroui/spinner";
import toast from 'react-hot-toast';

import {
  createSpeedLimit,
  getSpeedLimitList,
  updateSpeedLimit,
  deleteSpeedLimit
} from "@/api";

interface SpeedLimitRule {
  id: number;
  name: string;
  speed: number;
  status: number;
  createdTime?: number;
}

interface SpeedLimitForm {
  id?: number;
  name: string;
  speed: number;
  status: number;
}

export default function LimitPage() {
  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<SpeedLimitRule[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [ruleToDelete, setRuleToDelete] = useState<SpeedLimitRule | null>(null);

  const [form, setForm] = useState<SpeedLimitForm>({
    name: '',
    speed: 100,
    status: 1
  });

  const [errors, setErrors] = useState<{[key: string]: string}>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await getSpeedLimitList();
      if (res.code === 0) {
        setRules(res.data || []);
      } else {
        toast.error(res.msg || '获取限速规则失败');
      }
    } catch (error) {
      toast.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: {[key: string]: string} = {};
    if (!form.name.trim()) {
      newErrors.name = '请输入规则名称';
    }
    if (!form.speed || form.speed < 1) {
      newErrors.speed = '请输入有效的速度限制（≥1 Mbps）';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAdd = () => {
    setIsEdit(false);
    setForm({ name: '', speed: 100, status: 1 });
    setErrors({});
    setModalOpen(true);
  };

  const handleEdit = (rule: SpeedLimitRule) => {
    setIsEdit(true);
    setForm({ id: rule.id, name: rule.name, speed: rule.speed, status: rule.status });
    setErrors({});
    setModalOpen(true);
  };

  const handleDelete = (rule: SpeedLimitRule) => {
    setRuleToDelete(rule);
    setDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (!ruleToDelete) return;
    setDeleteLoading(true);
    try {
      const res = await deleteSpeedLimit(ruleToDelete.id);
      if (res.code === 0) {
        toast.success('删除成功');
        setDeleteModalOpen(false);
        loadData();
      } else {
        toast.error(res.msg || '删除失败');
      }
    } catch (error) {
      toast.error('删除失败');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    setSubmitLoading(true);
    try {
      let res;
      if (isEdit) {
        res = await updateSpeedLimit(form);
      } else {
        const { id, ...createData } = form;
        res = await createSpeedLimit(createData);
      }
      if (res.code === 0) {
        toast.success(isEdit ? '修改成功' : '创建成功');
        setModalOpen(false);
        loadData();
      } else {
        toast.error(res.msg || '操作失败');
      }
    } catch (error) {
      toast.error('操作失败');
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3">
          <Spinner size="sm" />
          <span className="text-default-600">正在加载...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 lg:px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">限速规则</h2>
          <p className="text-sm text-default-500 mt-1">规则创建后自动下发至所有在线节点, 转发可绑定</p>
        </div>
        <Button size="sm" variant="flat" color="primary" onPress={handleAdd}>新增</Button>
      </div>

      {rules.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
          {rules.map((rule) => (
            <Card key={rule.id} className="shadow-sm border border-gray-200 dark:border-gray-700">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start w-full">
                  <h3 className="font-semibold text-foreground">{rule.name}</h3>
                  <Chip color={rule.status === 1 ? "success" : "danger"} variant="flat" size="sm">
                    {rule.status === 1 ? '运行' : '异常'}
                  </Chip>
                </div>
              </CardHeader>
              <CardBody className="pt-0">
                <div className="flex justify-between items-center">
                  <span className="text-small text-default-600">速度限制</span>
                  <Chip color="secondary" variant="flat" size="sm">{rule.speed} Mbps</Chip>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button size="sm" variant="flat" color="primary" onPress={() => handleEdit(rule)} className="flex-1">
                    编辑
                  </Button>
                  <Button size="sm" variant="flat" color="danger" onPress={() => handleDelete(rule)} className="flex-1">
                    删除
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="shadow-sm border border-gray-200 dark:border-gray-700">
          <CardBody className="text-center py-16">
            <h3 className="text-lg font-semibold text-foreground">暂无限速规则</h3>
            <p className="text-default-500 text-sm mt-1">还没有创建任何限速规则，点击上方按钮开始创建</p>
          </CardBody>
        </Card>
      )}

      <Modal isOpen={modalOpen} onOpenChange={setModalOpen} size="2xl" scrollBehavior="outside" backdrop="blur" placement="center">
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-xl font-bold">{isEdit ? '编辑限速规则' : '新增限速规则'}</h2>
              </ModalHeader>
              <ModalBody>
                <div className="space-y-4">
                  <Input
                    label="规则名称"
                    placeholder="请输入限速规则名称"
                    value={form.name}
                    onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                    isInvalid={!!errors.name}
                    errorMessage={errors.name}
                    variant="bordered"
                  />
                  <Input
                    label="速度限制"
                    placeholder="请输入速度限制"
                    type="number"
                    value={form.speed.toString()}
                    onChange={(e) => setForm(prev => ({ ...prev, speed: parseInt(e.target.value) || 0 }))}
                    isInvalid={!!errors.speed}
                    errorMessage={errors.speed}
                    variant="bordered"
                    endContent={
                      <div className="pointer-events-none flex items-center">
                        <span className="text-default-400 text-small">Mbps</span>
                      </div>
                    }
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>取消</Button>
                <Button color="primary" onPress={handleSubmit} isLoading={submitLoading}>
                  {isEdit ? '保存修改' : '创建规则'}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal isOpen={deleteModalOpen} onOpenChange={setDeleteModalOpen} size="2xl" scrollBehavior="outside" backdrop="blur" placement="center">
        <ModalContent>
          {(onClose: () => void) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <h2 className="text-lg font-bold text-danger">确认删除</h2>
              </ModalHeader>
              <ModalBody>
                <p className="text-default-600">
                  确定要删除限速规则 <span className="font-semibold text-foreground">"{ruleToDelete?.name}"</span> 吗？
                </p>
                <p className="text-small text-default-500 mt-2">
                  若该规则正被转发绑定将无法删除。
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="light" onPress={onClose}>取消</Button>
                <Button color="danger" onPress={confirmDelete} isLoading={deleteLoading}>确认删除</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

import { Button, Input } from "@/components/ui";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { updatePassword } from "@/api";
import DefaultLayout from "@/layouts/default";
import { safeLogout } from "@/utils/logout";

interface PasswordForm {
  newUsername: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

export default function ChangePasswordPage() {
  const [form, setForm] = useState<PasswordForm>({
    newUsername: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Partial<PasswordForm>>({});
  const navigate = useNavigate();

  const validateForm = (): boolean => {
    const newErrors: Partial<PasswordForm> = {};

    if (!form.newUsername.trim()) {
      newErrors.newUsername = "请输入新用户名";
    } else if (form.newUsername.length < 3) {
      newErrors.newUsername = "用户名长度至少3位";
    } else if (form.newUsername.length > 20) {
      newErrors.newUsername = "用户名长度不能超过20位";
    }

    if (!form.currentPassword.trim()) newErrors.currentPassword = "请输入当前密码";

    if (!form.newPassword.trim()) {
      newErrors.newPassword = "请输入新密码";
    } else if (form.newPassword.length < 6) {
      newErrors.newPassword = "新密码长度不能少于6位";
    } else if (form.newPassword.length > 20) {
      newErrors.newPassword = "新密码长度不能超过20位";
    }

    if (!form.confirmPassword.trim()) {
      newErrors.confirmPassword = "请再次输入新密码";
    } else if (form.confirmPassword !== form.newPassword) {
      newErrors.confirmPassword = "两次输入密码不一致";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: keyof PasswordForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const response = await updatePassword(form);
      if (response.code === 0) {
        toast.success(response.msg || "账号密码修改成功，请重新登录");
        safeLogout();
        navigate("/", { replace: true });
      } else {
        toast.error(response.msg || "修改失败");
      }
    } catch {
      toast.error("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <DefaultLayout>
      <section className="flex items-center justify-center min-h-screen px-4">
        <div className="w-full max-w-sm">
          <div className="bg-surface border border-line rounded-2xl shadow-card p-6 space-y-4">
            <div>
              <h1 className="text-lg font-bold text-fg">首次登录请修改密码</h1>
              <p className="mt-1 text-[13px] text-muted">检测到默认账号密码，为安全起见请立即修改</p>
            </div>

            <Input
              label="新用户名"
              placeholder="至少3位"
              value={form.newUsername}
              onChange={(e) => handleInputChange("newUsername", e.target.value)}
              error={errors.newUsername}
            />
            <Input
              label="当前密码"
              type="password"
              value={form.currentPassword}
              onChange={(e) => handleInputChange("currentPassword", e.target.value)}
              error={errors.currentPassword}
            />
            <Input
              label="新密码"
              type="password"
              placeholder="至少6位"
              value={form.newPassword}
              onChange={(e) => handleInputChange("newPassword", e.target.value)}
              error={errors.newPassword}
            />
            <Input
              label="确认新密码"
              type="password"
              value={form.confirmPassword}
              onChange={(e) => handleInputChange("confirmPassword", e.target.value)}
              error={errors.confirmPassword}
            />

            <Button variant="primary" size="md" className="w-full" onClick={handleSubmit} loading={loading}>
              {loading ? "提交中..." : "修改并重新登录"}
            </Button>
          </div>
        </div>
      </section>
    </DefaultLayout>
  );
}

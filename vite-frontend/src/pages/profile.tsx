import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import { Button, Input, Modal, Card } from "@/components/ui";
import {
  IconNetwork,
  IconRoute,
  IconLayers,
  IconGauge,
  IconSettings,
  IconKey,
  IconLogout,
  IconChevronRight,
  IconSun,
  IconMoon,
} from "@/components/icons";
import { siteConfig } from "@/config/site";
import { updatePassword } from "@/api";
import { safeLogout } from "@/utils/logout";
import { useTheme } from "@/components/theme-provider";

interface PasswordForm {
  newUsername: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const MENU = [
  { path: "/wg", label: "WG 组网", description: "握手、路由、流量与延迟", icon: <IconNetwork size={18} /> },
  { path: "/link", label: "高级线路", description: "手工编排多跳线路", icon: <IconRoute size={18} /> },
  { path: "/group", label: "高级路由组", description: "组合线路与负载策略", icon: <IconLayers size={18} /> },
  { path: "/limit", label: "限速管理", description: "带宽限制规则", icon: <IconGauge size={18} /> },
  { path: "/config", label: "网站配置", description: "面板基本设置", icon: <IconSettings size={18} /> },
];

export default function ProfilePage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [username, setUsername] = useState("Admin");
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdForm, setPwdForm] = useState<PasswordForm>({
    newUsername: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });

  useEffect(() => {
    setUsername(localStorage.getItem("name") || "Admin");
  }, []);

  const handleLogout = () => {
    safeLogout();
    navigate("/");
  };

  const submitPassword = async () => {
    const f = pwdForm;
    if (!f.newUsername.trim() || f.newUsername.length < 3) return toast.error("用户名长度至少3位");
    if (!f.currentPassword) return toast.error("请输入当前密码");
    if (!f.newPassword || f.newPassword.length < 6) return toast.error("新密码长度不能少于6位");
    if (f.newPassword !== f.confirmPassword) return toast.error("两次输入密码不一致");

    setPwdLoading(true);
    try {
      const res = await updatePassword(f);
      if (res.code === 0) {
        toast.success("密码修改成功，请重新登录");
        setPwdOpen(false);
        handleLogout();
      } else {
        toast.error(res.msg || "密码修改失败");
      }
    } catch {
      toast.error("修改密码时发生错误");
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4 max-w-lg mx-auto">
      {/* 用户卡片 */}
      <Card className="flex items-center gap-4">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl text-white font-bold text-xl"
          style={{ background: "linear-gradient(135deg, var(--accent), #8b5cf6)" }}
        >
          {username.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-bold text-fg truncate">{username}</div>
          <div className="text-xs text-faint mt-0.5">
            {siteConfig.name} · v{siteConfig.version}
          </div>
        </div>
      </Card>

      {/* 功能列表 */}
      <Card padded={false} className="divide-y divide-line overflow-hidden">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-4 h-13 hover:bg-surface-2 transition-colors text-left"
        >
          <span className="text-accent">{theme === "dark" ? <IconMoon size={18} /> : <IconSun size={18} />}</span>
          <span className="flex-1 text-[14px] text-fg">外观主题</span>
          <span className="text-xs text-faint">{theme === "dark" ? "深色" : "浅色"}</span>
          <IconChevronRight size={14} className="text-faint" />
        </button>

        {MENU.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="w-full flex items-center gap-3 px-4 h-13 hover:bg-surface-2 transition-colors text-left"
          >
            <span className="text-accent">{item.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] text-fg">{item.label}</span>
              <span className="block text-[11px] text-faint">{item.description}</span>
            </span>
            <IconChevronRight size={14} className="text-faint" />
          </button>
        ))}

        <button
          onClick={() => {
            setPwdForm({ newUsername: username, currentPassword: "", newPassword: "", confirmPassword: "" });
            setPwdOpen(true);
          }}
          className="w-full flex items-center gap-3 px-4 h-13 hover:bg-surface-2 transition-colors text-left"
        >
          <span className="text-accent">
            <IconKey size={18} />
          </span>
          <span className="flex-1 text-[14px] text-fg">修改密码</span>
          <IconChevronRight size={14} className="text-faint" />
        </button>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-4 h-13 hover:bg-danger-soft transition-colors text-left"
        >
          <span className="text-danger">
            <IconLogout size={18} />
          </span>
          <span className="flex-1 text-[14px] text-danger">退出登录</span>
        </button>
      </Card>

      {/* 修改密码 */}
      <Modal
        open={pwdOpen}
        onClose={() => setPwdOpen(false)}
        title="修改密码"
        footer={
          <>
            <Button onClick={() => setPwdOpen(false)}>取消</Button>
            <Button variant="primary" onClick={submitPassword} loading={pwdLoading}>
              确定
            </Button>
          </>
        }
      >
        <div className="space-y-3.5">
          <Input
            label="新用户名"
            value={pwdForm.newUsername}
            onChange={(e) => setPwdForm({ ...pwdForm, newUsername: e.target.value })}
          />
          <Input
            label="当前密码"
            type="password"
            value={pwdForm.currentPassword}
            onChange={(e) => setPwdForm({ ...pwdForm, currentPassword: e.target.value })}
          />
          <Input
            label="新密码"
            type="password"
            value={pwdForm.newPassword}
            onChange={(e) => setPwdForm({ ...pwdForm, newPassword: e.target.value })}
          />
          <Input
            label="确认新密码"
            type="password"
            value={pwdForm.confirmPassword}
            onChange={(e) => setPwdForm({ ...pwdForm, confirmPassword: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  );
}

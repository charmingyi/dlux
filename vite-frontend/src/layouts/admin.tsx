import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import clsx from "clsx";
import toast from "react-hot-toast";

import {
  IconDashboard,
  IconShuffle,
  IconNetwork,
  IconRoute,
  IconLayers,
  IconServer,
  IconGauge,
  IconSettings,
  IconSun,
  IconMoon,
  IconMenu,
  IconX,
  IconUser,
  IconKey,
  IconLogout,
  IconChevronDown,
} from "@/components/icons";
import { Button, IconButton, Input, Modal, Dropdown, DropdownItem, DropdownDivider } from "@/components/ui";
import { useTheme } from "@/components/theme-provider";
import { updatePassword } from "@/api";
import { safeLogout } from "@/utils/logout";
import { siteConfig } from "@/config/site";

interface PasswordForm {
  newUsername: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const NAV_GROUPS: Array<{ title: string; items: Array<{ path: string; label: string; icon: React.ReactNode }> }> = [
  {
    title: "总览",
    items: [{ path: "/dashboard", label: "仪表板", icon: <IconDashboard size={17} /> }],
  },
  {
    title: "业务",
    items: [{ path: "/forward", label: "转发管理", icon: <IconShuffle size={17} /> }],
  },
  {
    title: "网络",
    items: [
      { path: "/wg", label: "WireGuard 组网", icon: <IconNetwork size={17} /> },
      { path: "/link", label: "线路管理", icon: <IconRoute size={17} /> },
      { path: "/group", label: "负载均衡", icon: <IconLayers size={17} /> },
    ],
  },
  {
    title: "资源",
    items: [
      { path: "/node", label: "节点监控", icon: <IconServer size={17} /> },
      { path: "/limit", label: "限速管理", icon: <IconGauge size={17} /> },
    ],
  },
  {
    title: "系统",
    items: [{ path: "/config", label: "网站配置", icon: <IconSettings size={17} /> }],
  },
];

const LogoMark: React.FC<{ size?: number }> = ({ size = 30 }) => (
  <div
    className="flex items-center justify-center rounded-xl text-white font-bold shrink-0"
    style={{
      width: size,
      height: size,
      background: "linear-gradient(135deg, var(--accent), #8b5cf6)",
      fontSize: size * 0.45,
    }}
  >
    D
  </div>
);

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  const [isMobile, setIsMobile] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
    const check = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (!mobile) setMenuOpen(false);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleLogout = () => {
    safeLogout();
    navigate("/");
  };

  const currentLabel = () => {
    for (const g of NAV_GROUPS) {
      const item = g.items.find((i) => i.path === location.pathname);
      if (item) return item.label;
    }
    return "";
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

  const nav = (
    <>
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-line shrink-0">
        <LogoMark />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold text-fg truncate leading-tight">{siteConfig.name}</div>
          <div className="text-[11px] text-faint leading-tight">v{siteConfig.version}</div>
        </div>
        {isMobile && (
          <IconButton size="xs" onClick={() => setMenuOpen(false)} aria-label="关闭菜单">
            <IconX size={16} />
          </IconButton>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            <div className="px-2.5 mb-1.5 text-[11px] font-medium text-faint tracking-wider">{group.title}</div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <li key={item.path}>
                    <button
                      onClick={() => {
                        navigate(item.path);
                        setMenuOpen(false);
                      }}
                      className={clsx(
                        "w-full flex items-center gap-2.5 px-2.5 h-9 rounded-lg text-[13px] font-medium transition-colors",
                        active
                          ? "bg-accent-soft text-accent"
                          : "text-muted hover:text-fg hover:bg-surface-2"
                      )}
                    >
                      <span className={clsx("shrink-0", active ? "text-accent" : "text-faint")}>{item.icon}</span>
                      <span className="truncate">{item.label}</span>
                      {active && <span className="ml-auto h-4 w-1 rounded-full bg-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-line shrink-0">
        <div className="text-[11px] text-faint text-center">dlux relay panel</div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-bg">
      {/* 移动端遮罩 */}
      {isMobile && menuOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] animate-fade-in" onClick={() => setMenuOpen(false)} />
      )}

      {/* 侧边栏 */}
      <aside
        className={clsx(
          "fixed z-50 top-0 left-0 h-screen w-60 bg-surface border-r border-line flex flex-col transition-transform duration-200",
          isMobile ? (menuOpen ? "translate-x-0" : "-translate-x-full") : "sticky translate-x-0"
        )}
      >
        {nav}
      </aside>

      {/* 主区域 */}
      <div className="flex flex-col flex-1 min-w-0">
        <header className="sticky top-0 z-30 h-14 bg-surface/80 backdrop-blur border-b border-line flex items-center gap-3 px-4 lg:px-6">
          {isMobile && (
            <IconButton onClick={() => setMenuOpen(true)} aria-label="打开菜单">
              <IconMenu size={18} />
            </IconButton>
          )}
          <h2 className="text-[15px] font-semibold text-fg">{currentLabel()}</h2>

          <div className="ml-auto flex items-center gap-1.5">
            <IconButton onClick={toggleTheme} aria-label="切换主题" title={theme === "dark" ? "切换到浅色" : "切换到深色"}>
              {theme === "dark" ? <IconSun size={17} /> : <IconMoon size={17} />}
            </IconButton>

            <Dropdown
              width="w-40"
              trigger={
                <button className="flex items-center gap-1.5 h-8 px-2 rounded-lg hover:bg-surface-2 transition-colors text-[13px] font-medium text-fg">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <IconUser size={13} />
                  </span>
                  <span className="max-w-24 truncate">{username}</span>
                  <IconChevronDown size={13} className="text-faint" />
                </button>
              }
            >
              <DropdownItem
                onClick={() => {
                  setPwdForm({ newUsername: username, currentPassword: "", newPassword: "", confirmPassword: "" });
                  setPwdOpen(true);
                }}
              >
                <IconKey size={14} /> 修改密码
              </DropdownItem>
              <DropdownDivider />
              <DropdownItem danger onClick={handleLogout}>
                <IconLogout size={14} /> 退出登录
              </DropdownItem>
            </Dropdown>
          </div>
        </header>

        <main className="flex-1 min-w-0">{children}</main>
      </div>

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
            placeholder="至少3位"
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
            placeholder="至少6位"
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

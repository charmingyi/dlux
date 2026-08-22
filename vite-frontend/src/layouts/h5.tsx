import React, { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import clsx from "clsx";

import { IconDashboard, IconShuffle, IconNetwork, IconServer, IconUser } from "@/components/icons";
import { siteConfig } from "@/config/site";

const TABS = [
  { path: "/dashboard", label: "首页", icon: <IconDashboard size={21} /> },
  { path: "/forward", label: "转发", icon: <IconShuffle size={21} /> },
  { path: "/wg", label: "组网", icon: <IconNetwork size={21} /> },
  { path: "/node", label: "节点", icon: <IconServer size={21} /> },
  { path: "/profile", label: "我的", icon: <IconUser size={21} /> },
];

export default function H5Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex flex-col min-h-screen bg-bg">
      <header
        className="sticky top-0 z-30 bg-surface/85 backdrop-blur border-b border-line flex h-13 items-center px-4"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div
          className="flex items-center justify-center rounded-lg text-white font-bold shrink-0"
          style={{ width: 24, height: 24, background: "linear-gradient(135deg, var(--accent), #8b5cf6)", fontSize: 12 }}
        >
          D
        </div>
        <h1 className="ml-2 text-[15px] font-bold text-fg truncate">{siteConfig.name}</h1>
        <span className="ml-auto text-[11px] text-faint">v{siteConfig.version}</span>
      </header>

      <main className="flex-1">{children}</main>

      <div aria-hidden style={{ height: "calc(3.5rem + env(safe-area-inset-bottom))" }} />

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 bg-surface/95 backdrop-blur border-t border-line flex items-stretch"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {TABS.map((tab) => {
          const active = location.pathname === tab.path;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={clsx(
                "flex flex-col items-center justify-center gap-0.5 flex-1 h-14 transition-colors",
                active ? "text-accent" : "text-faint"
              )}
            >
              {tab.icon}
              <span className="text-[10px] font-medium">{tab.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

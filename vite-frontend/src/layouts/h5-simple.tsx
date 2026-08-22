import React, { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

import { siteConfig } from "@/config/site";

/** 移动端二级页面布局: 顶栏带返回按钮 */
export default function H5SimpleLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <div className="flex flex-col min-h-screen bg-bg">
      <header
        className="sticky top-0 z-30 bg-surface/85 backdrop-blur border-b border-line flex h-13 items-center px-3 gap-1"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <button
          onClick={() => navigate("/profile")}
          className="flex items-center justify-center h-9 w-9 -ml-1 rounded-lg text-muted hover:bg-surface-2"
          aria-label="返回"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <h1 className="text-[15px] font-bold text-fg truncate">{siteConfig.name}</h1>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

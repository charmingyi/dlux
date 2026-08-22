import React from "react";

/** 登录页等无框架页面的基础布局 */
export default function DefaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex flex-col min-h-screen bg-bg">
      <main className="flex-1">{children}</main>
    </div>
  );
}

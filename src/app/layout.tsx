import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "AgentOS | Controlled Agent Workspace",
  description: "A controlled runtime for trustworthy software analysis",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell lg:flex">
          <Sidebar />
          <div className="workspace min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}

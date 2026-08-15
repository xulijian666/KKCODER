import { Suspense, useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useTokenTrackerServer } from "./useTokenTrackerServer";

const TT_INSTALL_COMMAND = "npm i -g tokentracker-cli";

/**
 * TokenTracker 本地服务门控（移植自 CC-GUI `TokenTrackerServerGate`）：
 * CLI 检测 / 一键安装 / server 启动 / 错误重试，ready 后渲染 children
 * （vendored 使用统计仪表盘）。
 */
type TokenTrackerServerGateProps = {
  /** guide 卡片顶部图标（lucide 组件）。 */
  icon: ComponentType<{ size?: number }>;
  /** ready 态包裹 children 的容器 class。 */
  dashboardClassName: string;
  children: ReactNode;
};

function GateStatus({ label }: { label: string }) {
  return (
    <div className="ext-usage-status" role="status">
      <span className="ext-usage-spinner" aria-hidden />
      <p>{label}</p>
    </div>
  );
}

export function TokenTrackerServerGate({
  icon: GuideIcon,
  dashboardClassName,
  children,
}: TokenTrackerServerGateProps) {
  const { state, retry, install } = useTokenTrackerServer();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const handleCopyInstallCommand = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(TT_INSTALL_COMMAND);
      setCopied(true);
    } catch {
      // 剪贴板被拒时保持原状，不打断引导流程。
    }
  };

  if (state.status === "checking" || state.status === "starting") {
    return (
      <div className="ext-usage-section">
        <GateStatus
          label={
            state.status === "checking"
              ? "正在检测 TokenTracker CLI..."
              : "正在启动本地统计服务..."
          }
        />
      </div>
    );
  }

  if (state.status === "installing") {
    return (
      <div className="ext-usage-section">
        <div className="ext-usage-card">
          <div className="ext-usage-progress" role="status">
            <span className="ext-usage-spinner" aria-hidden />
            <strong>正在安装 tokentracker-cli...</strong>
          </div>
          <p>通过 npm 全局安装，最多可能需要 3 分钟，请稍候。</p>
        </div>
      </div>
    );
  }

  if (state.status === "guide") {
    return (
      <div className="ext-usage-section">
        <div className="ext-usage-card">
          <div className="ext-usage-card-icon" aria-hidden>
            <GuideIcon size={20} />
          </div>
          <h2>需要 TokenTracker CLI</h2>
          <p>
            使用统计依赖 <code>tokentracker-cli</code>（本地记录 AI 用量与费用的命令行工具）。
            请先安装，然后重试。
          </p>
          <div className="ext-usage-install">
            <span className="ext-usage-install-label">安装命令</span>
            <code>{TT_INSTALL_COMMAND}</code>
            <button
              type="button"
              className="ext-usage-btn ext-usage-btn-outline"
              onClick={() => void handleCopyInstallCommand()}
            >
              {copied ? "已复制" : "复制"}
            </button>
            <button
              type="button"
              className="ext-usage-btn ext-usage-btn-primary"
              onClick={install}
            >
              一键安装
            </button>
          </div>
          <p className="ext-usage-card-note">
            安装后 TokenTracker 会在 Claude Code 中注入统计钩子（Session
            Hooks），自动记录每次对话的 token 用量与费用。
          </p>
          <p className="ext-usage-card-note">
            全程本地记录，数据不会上传；服务默认绑定 127.0.0.1。
          </p>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="ext-usage-section">
        <div className="ext-usage-card">
          <h2>启动失败</h2>
          <code className="ext-usage-error-detail">{state.message}</code>
          <div className="ext-usage-card-actions">
            <button
              type="button"
              className="ext-usage-btn ext-usage-btn-outline"
              onClick={retry}
            >
              重试
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ext-usage-section">
      <div className={dashboardClassName}>
        <Suspense fallback={<GateStatus label="正在加载使用统计仪表盘..." />}>
          {children}
        </Suspense>
      </div>
    </div>
  );
}

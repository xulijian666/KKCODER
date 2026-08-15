import React, { lazy, Suspense, useEffect, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Bot,
  Package,
  Puzzle,
  ScrollText,
  Server,
  TerminalSquare,
  Webhook,
} from "lucide-react";
import { TokenTrackerServerGate } from "./TokenTrackerServerGate";
import "./tokentracker-theme.css";
import "./tokentracker-dashboard.css";
import "./ExtensionsPanel.css";

// 整个 vendored 仪表盘（含 motion / @base-ui 依赖）隔离在异步 chunk。
const LazyTokenTrackerDashboard = lazy(() => import("./TokenTrackerDashboardView"));
// vendored 技能中心（SkillsPage）同样隔离在异步 chunk。
const LazyTokenTrackerSkills = lazy(() => import("./TokenTrackerSkillsView"));

export type ExtensionMenuId =
  | "usage"
  | "skills"
  | "mcps"
  | "plugins"
  | "hooks"
  | "rules"
  | "commands"
  | "subagents";

interface MenuItem {
  id: ExtensionMenuId;
  label: string;
  group: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description: string;
  implemented: boolean;
}

const EXTENSIONS_MENU: MenuItem[] = [
  {
    id: "usage",
    label: "使用统计",
    group: "数据与分析",
    icon: BarChart3,
    title: "使用统计 (TokenTracker)",
    description: "实时监控 AI 会话的 Token 吞吐、费用支出、模型分布与活跃趋势",
    implemented: true,
  },
  {
    id: "skills",
    label: "技能 (Skills)",
    group: "AI 框架扩展",
    icon: Package,
    title: "技能库管理",
    description: "管理可复用的技能包，配置 Claude Code 与 AI 智能体可调用的专用技能",
    implemented: true,
  },
  {
    id: "mcps",
    label: "MCP 服务器",
    group: "AI 框架扩展",
    icon: Server,
    title: "Model Context Protocol",
    description: "配置并连接 MCP 服务器，为 AI 扩展外部工具、数据库和实时系统调用",
    implemented: false,
  },
  {
    id: "plugins",
    label: "插件 (Plugins)",
    group: "AI 框架扩展",
    icon: Puzzle,
    title: "客户端插件系统",
    description: "安装和管理编辑器扩展插件，丰富 KKCoder 客户端功能与工作流",
    implemented: false,
  },
  {
    id: "hooks",
    label: "Hooks 钩子",
    group: "AI 框架扩展",
    icon: Webhook,
    title: "会话生命周期钩子",
    description: "在会话启动、命令执行、工具调用等关键节点触发自定义自动化脚本",
    implemented: false,
  },
  {
    id: "rules",
    label: "项目规则",
    group: "AI 框架扩展",
    icon: ScrollText,
    title: "规则与系统指令",
    description: "集中管理 RULE.md、CLAUDE.md 与 AGENTS.md 统一规则规范",
    implemented: false,
  },
  {
    id: "commands",
    label: "自定义命令",
    group: "AI 框架扩展",
    icon: TerminalSquare,
    title: "快捷斜杠命令",
    description: "配置专属 Slash Commands，在输入框中快速调用常用 Prompt 模板与流水线",
    implemented: false,
  },
  {
    id: "subagents",
    label: "子代理 (Subagents)",
    group: "AI 框架扩展",
    icon: Bot,
    title: "多智能体协作",
    description: "定义特定职责的子代理（研究员、重构专家、代码审查员）实现并行协作",
    implemented: false,
  },
];

const EXTENSIONS_GROUPS = ["数据与分析", "AI 框架扩展"] as const;

interface ExtensionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExtensionsPanel: React.FC<ExtensionsPanelProps> = ({ isOpen, onClose }) => {
  const [activeMenu, setActiveMenu] = useState<ExtensionMenuId>("usage");
  const [closing, setClosing] = useState(false);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      setClosing(false);
      onClose();
    }, 180);
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 若子弹窗已阻止默认行为、存在子模态框、或技能详情抽屉打开，
        // 则优先交给子层关闭，不关闭扩展主面板。
        if (
          e.defaultPrevented ||
          document.querySelector("[data-tt-modal='true']") ||
          document.querySelector(".skc-drawer")
        ) {
          return;
        }
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!isOpen && !closing) {
    return null;
  }

  const currentItem = EXTENSIONS_MENU.find((item) => item.id === activeMenu) || EXTENSIONS_MENU[0];

  return (
    <div className={`ext-embedded ${closing ? "is-closing" : "is-open"}`}>
      <div className="ext-body">
        {/* 左侧侧边栏导航（与设置面板结构和视觉 100% 对齐） */}
        <aside className="ext-sidebar">
          <div className="ext-sidebar-drag" data-tauri-drag-region="true" />
          
          <button
            type="button"
            className="ext-nav ext-nav-return"
            onClick={handleClose}
            aria-label="返回应用"
            title="返回应用 (Esc)"
          >
            <ArrowLeft size={13} aria-hidden />
            <span className="ext-nav-label">返回应用</span>
          </button>

          <nav className="ext-sidebar-nav" aria-label="拓展分类">
            {EXTENSIONS_GROUPS.map((groupName) => {
              const items = EXTENSIONS_MENU.filter((item) => item.group === groupName);
              if (items.length === 0) return null;
              return (
                <div key={groupName} className="ext-nav-group">
                  <div className="ext-nav-group-label">{groupName}</div>
                  {items.map((item) => {
                    const NavIcon = item.icon;
                    const isActive = activeMenu === item.id;
                    const isAvailable = item.implemented;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={!isAvailable}
                        className={`ext-nav ${isActive ? "active" : ""} ${!isAvailable ? "is-disabled" : ""}`}
                        onClick={() => isAvailable && setActiveMenu(item.id)}
                        title={isAvailable ? item.label : undefined}
                      >
                        <NavIcon size={17} aria-hidden />
                        <span className="ext-nav-label">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* 右侧 100% 满宽自适应流体内容区 */}
        <div className="ext-content-wrap">
          <div className="ext-page-head" data-tauri-drag-region="true">
            <div className="ext-page-head-inner">
              <h1 className="ext-page-title">{currentItem.title}</h1>
              <p className="ext-page-description">{currentItem.description}</p>
            </div>
          </div>

          <div className="ext-scroll">
            <div className="ext-content">
              {activeMenu === "usage" && (
                <div className="ext-usage-fluid-container">
                  <TokenTrackerServerGate
                    icon={BarChart3}
                    dashboardClassName="ext-usage-dashboard"
                  >
                    <Suspense fallback={null}>
                      <LazyTokenTrackerDashboard />
                    </Suspense>
                  </TokenTrackerServerGate>
                </div>
              )}

              {activeMenu === "skills" && (
                <div className="ext-skills-container">
                  <Suspense fallback={null}>
                    <LazyTokenTrackerSkills />
                  </Suspense>
                </div>
              )}

              {activeMenu !== "usage" && activeMenu !== "skills" && (
                <div className="ext-empty-state">
                  <div className="ext-empty-icon">
                    <currentItem.icon size={26} />
                  </div>
                  <div className="ext-empty-title">{currentItem.title}</div>
                  <div className="ext-empty-desc">{currentItem.description}</div>
                  <div className="ext-empty-badge">功能模块开发中 · 敬请期待</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from "react";
import type { ClaudeModelInfo } from "../utils/claudeModel";
import { log } from "../utils/log";

interface ModelSelectorProps {
  selectedModel: string | null;
  modelInfo: ClaudeModelInfo | null;
  onSelectModel: (model: string | null) => void;
  onSelectProvider: (providerId: string) => void;
  onRefreshModelInfo?: () => void;
  /** AI 思考中禁用切换（当前会话忙） */
  disabled?: boolean;
}

/** 聊天输入框旁的模型/供应商选择器：点供应商定死默认（菜单保持打开可接着选模型），点模型或菜单外关闭 */
export const ModelSelector: React.FC<ModelSelectorProps> = ({
  selectedModel,
  modelInfo,
  onSelectModel,
  onSelectProvider,
  onRefreshModelInfo,
  disabled = false,
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayModel = selectedModel || modelInfo?.defaultModel || "模型";

  // 点击菜单外部任意处关闭
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      const node = containerRef.current;
      if (node && !node.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  // 思考中禁用：关闭可能已打开的菜单
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const toggle = () => {
    if (disabled) return;
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) onRefreshModelInfo?.();
  };

  // 路由开关状态：常驻显示在触发按钮上，一眼看出 CC Switch 路由开关开没开
  const routeEnabled = modelInfo?.routeEnabled ?? false;

  return (
    <div className="chat-model-select" ref={containerRef}>
      <button
        type="button"
        className={`chat-model-select-btn ${open ? "active" : ""} ${disabled ? "is-disabled" : ""}`}
        onClick={toggle}
        disabled={disabled}
        title={
          disabled
            ? "AI 思考中，暂时不能切换模型"
            : `${routeEnabled ? "路由已开（走 CC Switch 代理）" : "路由已关（直连）"} · ` +
              (selectedModel
            ? `当前模型：${selectedModel}`
            : modelInfo?.defaultModel
              ? `当前模型：${modelInfo.defaultModel}（该供应商默认）`
              : "选择模型 / 供应商")
        }
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"></path>
        </svg>
        <span className="chat-model-select-label">{displayModel}</span>
        {routeEnabled && (
          <span className="chat-model-route-dot" title="CC Switch 路由开关已开启" />
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <path d="m6 9 6 6 6-6"></path>
        </svg>
      </button>

      {open && (
        <div
          className="model-dropdown chat-model-dropdown"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {modelInfo && (
            <div className="model-dropdown-header">
              <span
                className="model-dropdown-provider"
                title={
                  modelInfo.providerRemoved
                    ? "当前直连的供应商已从 CC Switch 移除"
                    : (modelInfo.providerName ?? undefined)
                }
              >
                {modelInfo.providerRemoved
                  ? "未知供应商（已移除）"
                  : (modelInfo.providerName ?? "CC Switch")}
              </span>
              <span
                className={`model-dropdown-mode ${modelInfo.routeEnabled ? "is-route" : ""}`}
                title={
                  modelInfo.routeEnabled
                    ? "CC Switch 路由开关已开启，请求走本地代理"
                    : "CC Switch 路由开关未开启，请求直连"
                }
              >
                {modelInfo.routeEnabled ? "路由已开" : "路由已关"}
              </span>
            </div>
          )}
          <div className="model-dropdown-section-title">供应商</div>
          {modelInfo && modelInfo.providers.length > 0 ? (
            <div className="model-dropdown-provider-list">
              {modelInfo.providers.map((provider) => {
                const isCurrent = provider.name === modelInfo.providerName;
                return (
                  <div
                    key={provider.id}
                    className={`model-dropdown-item ${isCurrent ? "active" : ""}`}
                    title={provider.baseUrl || undefined}
                    onClick={() => {
                      // 选供应商保持菜单打开，模型清单会刷新成该供应商的，便于接着选模型
                      log(`[model] select provider=${provider.id} (${provider.name})`);
                      onSelectProvider(provider.id);
                    }}
                  >
                    <span className="model-dropdown-item-label">{provider.name}</span>
                    <span className="model-dropdown-item-end">
                      {provider.routeOnly && (
                        <span
                          className="model-dropdown-route-badge"
                          title="该供应商需要开启路由（走 CC Switch 代理）才能使用"
                        >
                          需要路由
                        </span>
                      )}
                      {isCurrent && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5"></path>
                        </svg>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="model-dropdown-empty">未读取到供应商</div>
          )}
          <div className="model-dropdown-divider" />
          <div className="model-dropdown-section-title">模型</div>
          <div className="model-dropdown-model-list">
            {modelInfo && modelInfo.models.length > 0
              ? modelInfo.models.map((model) => {
                  const isSelected = selectedModel === model;
                  return (
                    <div
                      key={model}
                      className={`model-dropdown-item ${isSelected ? "active" : ""}`}
                      title={isSelected ? "再次点击取消，回到该供应商默认" : undefined}
                      onClick={() => {
                        // 再次点击已选中的模型 = 取消选择，回到该供应商默认（兜底态）
                        log(`[model] select model=${model} (cancel=${isSelected})`);
                        onSelectModel(isSelected ? null : model);
                        setOpen(false);
                      }}
                    >
                      <span className="model-dropdown-item-label">{model}</span>
                      {isSelected && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5"></path>
                        </svg>
                      )}
                    </div>
                  );
                })
              : null}
            {(!modelInfo || modelInfo.models.length === 0) && (
              <div className="model-dropdown-empty">未读取到模型配置</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

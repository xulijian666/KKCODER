import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, RefreshCw, ShieldBan, ShieldCheck } from "lucide-react";
import { buildInlineHtmlPreview } from "../utils/htmlPreview";
import { formatFeedbackError, notifyError } from "../utils/appFeedback";
import { getFileNameFromPath } from "../utils/filePreview";

export interface HtmlPreviewProps {
  projectPath: string | undefined;
  relativePath: string;
  content: string;
}

/**
 * HTML 侧边预览：iframe srcdoc + 本地资源内联。
 * 默认禁用脚本（VS Code untrusted 预览语义），工具栏可显式开启。
 */
export const HtmlPreview: React.FC<HtmlPreviewProps> = ({
  projectPath,
  relativePath,
  content,
}) => {
  const [previewHtml, setPreviewHtml] = useState(content);
  const [loading, setLoading] = useState(true);
  const [allowScripts, setAllowScripts] = useState(false);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [blockedScriptCount, setBlockedScriptCount] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!projectPath) {
      setPreviewHtml(content);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // 输入防抖：编辑时避免每个按键都重建整棵 DOM + 读文件
    const timer = window.setTimeout(() => {
      void buildInlineHtmlPreview(content, projectPath, relativePath, allowScripts)
        .then((result) => {
          if (cancelled) return;
          setPreviewHtml(result.html);
          setUnresolvedCount(result.unresolvedCount);
          setBlockedScriptCount(result.blockedScriptCount);
        })
        .catch(() => {
          if (cancelled) return;
          setPreviewHtml(content);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [allowScripts, content, projectPath, relativePath, reloadToken]);

  const openInSystemBrowser = () => {
    if (!projectPath) return;
    const separator = projectPath.endsWith("/") || projectPath.endsWith("\\") ? "" : "/";
    const absolutePath = `${projectPath}${separator}${relativePath}`;
    invoke("open_file_in_system", { path: absolutePath }).catch((error) =>
      notifyError(`打开失败：${formatFeedbackError(error)}`),
    );
  };

  const sandbox = allowScripts
    ? "allow-scripts allow-modals allow-forms allow-popups"
    : "";

  return (
    <div className="html-preview-pane">
      <div className="html-preview-toolbar">
        <span className="html-preview-file" title={relativePath}>
          {getFileNameFromPath(relativePath)}
        </span>
        {loading && <span className="html-preview-status">渲染中…</span>}
        {!loading && unresolvedCount > 0 && (
          <span className="html-preview-status warning" title="部分本地资源无法内联，预览可能不完整">
            {unresolvedCount} 个资源未加载
          </span>
        )}
        {!loading && !allowScripts && blockedScriptCount > 0 && (
          <span className="html-preview-status" title="脚本已被 sandbox 拦截">
            {blockedScriptCount} 个脚本已阻止
          </span>
        )}
        <div className="html-preview-actions">
          <button
            className="html-preview-btn"
            onClick={() => setReloadToken((value) => value + 1)}
            title="刷新预览"
          >
            <RefreshCw size={13} />
          </button>
          <button
            className={`html-preview-btn ${allowScripts ? "active" : ""}`}
            onClick={() => setAllowScripts((value) => !value)}
            title={
              allowScripts
                ? "脚本已允许执行（点击禁用）"
                : "脚本已禁用（VS Code 安全语义，点击允许）"
            }
          >
            {allowScripts ? <ShieldCheck size={13} /> : <ShieldBan size={13} />}
          </button>
          <button
            className="html-preview-btn"
            onClick={openInSystemBrowser}
            title="在系统浏览器中打开"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>
      <div className="html-preview-frame-wrap">
        <iframe
          key={`${reloadToken}-${allowScripts}`}
          className="html-preview-frame"
          title={`${relativePath} 预览`}
          sandbox={sandbox}
          srcDoc={previewHtml}
        />
      </div>
    </div>
  );
};

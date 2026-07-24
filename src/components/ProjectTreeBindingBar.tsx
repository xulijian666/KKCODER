import React from "react";
import type { ProjectTreeBindingMode } from "../utils/projectTreeBinding";

export interface ProjectTreeBindingBarProps {
  isDualSplit: boolean;
  bindingMode: ProjectTreeBindingMode;
  onBindingModeChange: (mode: ProjectTreeBindingMode) => void;
  primaryLabel: string;
  secondaryLabel: string;
  boundFolderName: string;
  boundPath: string;
  /** 两格是否同一项目路径 */
  sameProject: boolean;
}

/**
 * 项目文件树顶栏：路径摘要 + 分屏绑定（跟随 / 钉左 / 钉右）。
 */
export const ProjectTreeBindingBar: React.FC<ProjectTreeBindingBarProps> = ({
  isDualSplit,
  bindingMode,
  onBindingModeChange,
  primaryLabel,
  secondaryLabel,
  boundFolderName,
  boundPath,
  sameProject,
}) => {
  return (
    <div className="project-tree-aside-header">
      <div className="project-tree-header-main">
        <span className="aside-header-title">项目文件</span>
        {boundFolderName ? (
          <span className="aside-header-path" title={boundPath}>
            {boundFolderName}
          </span>
        ) : null}
      </div>

      {isDualSplit && (
        <div
          className="project-tree-binding-controls"
          role="group"
          aria-label="项目树绑定"
        >
          <button
            type="button"
            className={`project-tree-binding-btn ${
              bindingMode === "follow-focus" ? "is-active" : ""
            }`}
            title="跟随当前聚焦的终端会话"
            onClick={() => onBindingModeChange("follow-focus")}
          >
            跟随
          </button>
          <button
            type="button"
            className={`project-tree-binding-btn binding-primary ${
              bindingMode === "primary" ? "is-active" : ""
            }`}
            title={`钉在左侧：${primaryLabel}`}
            onClick={() => onBindingModeChange("primary")}
          >
            左
          </button>
          <button
            type="button"
            className={`project-tree-binding-btn binding-secondary ${
              bindingMode === "secondary" ? "is-active" : ""
            }`}
            title={`钉在右侧：${secondaryLabel}`}
            onClick={() => onBindingModeChange("secondary")}
          >
            右
          </button>
          {sameProject && (
            <span className="project-tree-binding-hint" title="两侧会话为同一项目路径">
              同项目
            </span>
          )}
        </div>
      )}
    </div>
  );
};

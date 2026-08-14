import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, Minus, Plus, Scan, Scaling } from "lucide-react";
import { formatFeedbackError, notifyError } from "../utils/appFeedback";
import { getFileNameFromPath, isSvgPreviewPath } from "../utils/filePreview";

export interface ImagePreviewProps {
  projectPath: string | undefined;
  relativePath: string;
  /** SVG：原始 UTF-8 文本；位图：data:image/...;base64,... */
  content: string;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 20;

function clampScale(value: number): number {
  return Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));
}

/** VS Code 图片预览体验：fit 默认、缩放 10%~2000%、1:1、显示像素尺寸、Ctrl+滚轮缩放 */
export const ImagePreview: React.FC<ImagePreviewProps> = ({
  projectPath,
  relativePath,
  content,
}) => {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string>("");
  const [scale, setScale] = useState<number>(1);
  const [fit, setFit] = useState(true);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);

  // SVG 用 Blob URL 渲染（<img> 不会执行 SVG 内脚本，安全）
  useEffect(() => {
    if (!isSvgPreviewPath(relativePath)) {
      setSrc(content);
      return;
    }
    const url = URL.createObjectURL(new Blob([content], { type: "image/svg+xml" }));
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [content, relativePath]);

  const zoomIn = () => {
    setFit(false);
    setScale((value) => clampScale(value * 1.25));
  };

  const zoomOut = () => {
    setFit(false);
    setScale((value) => clampScale(value / 1.25));
  };

  const actualSize = () => {
    setFit(false);
    setScale(1);
  };

  const toggleFit = () => {
    setFit((value) => !value);
  };

  const openInSystemApp = () => {
    if (!projectPath) return;
    const separator = projectPath.endsWith("/") || projectPath.endsWith("\\") ? "" : "/";
    const absolutePath = `${projectPath}${separator}${relativePath}`;
    invoke("open_file_in_system", { path: absolutePath }).catch((error) =>
      notifyError(`打开失败：${formatFeedbackError(error)}`),
    );
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY < 0) zoomIn();
      else zoomOut();
    };
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const displayScale = fit ? "适应窗口" : `${Math.round(scale * 100)}%`;

  return (
    <div className="image-preview-pane">
      <div className="image-preview-toolbar">
        <span className="image-preview-file" title={relativePath}>
          {getFileNameFromPath(relativePath)}
        </span>
        {naturalSize && (
          <span className="image-preview-dimensions">
            {naturalSize.width} × {naturalSize.height}
          </span>
        )}
        <div className="image-preview-actions">
          <button className="image-preview-btn" onClick={zoomOut} title="缩小 (Ctrl+滚轮)">
            <Minus size={13} />
          </button>
          <span className="image-preview-scale">{displayScale}</span>
          <button className="image-preview-btn" onClick={zoomIn} title="放大 (Ctrl+滚轮)">
            <Plus size={13} />
          </button>
          <button
            className={`image-preview-btn ${fit ? "active" : ""}`}
            onClick={toggleFit}
            title={fit ? "实际大小" : "适应窗口"}
          >
            {fit ? <Scaling size={13} /> : <Scan size={13} />}
          </button>
          <button className="image-preview-btn" onClick={actualSize} title="1:1 实际像素">
            1:1
          </button>
          <button
            className="image-preview-btn"
            onClick={openInSystemApp}
            title="用系统默认程序打开"
          >
            <ExternalLink size={13} />
          </button>
        </div>
      </div>
      <div className="image-preview-canvas" ref={canvasRef}>
        {src && (
          <img
            className={`image-preview-img ${fit ? "is-fit" : ""}`}
            src={src}
            alt={getFileNameFromPath(relativePath)}
            style={fit ? undefined : { transform: `scale(${scale})` }}
            onLoad={(event) => {
              const image = event.currentTarget;
              setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
            }}
          />
        )}
      </div>
    </div>
  );
};

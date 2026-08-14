/**
 * 文件预览类型判定：文本（Monaco 编辑）/ 图片（VS Code 式图片查看器）。
 * 纯函数，不依赖 React 或 Tauri。
 */

export type FilePreviewKind = "text" | "image";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "jpe",
  "gif",
  "webp",
  "bmp",
  "ico",
  "avif",
  "svg",
]);

const HTML_EXTENSIONS = new Set(["html", "htm"]);

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
};

function getExtension(relativePath: string): string {
  const name = relativePath.split(/[/\\]/).pop() || relativePath;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function getFilePreviewKind(relativePath: string): FilePreviewKind {
  return IMAGE_EXTENSIONS.has(getExtension(relativePath)) ? "image" : "text";
}

export function isImagePreviewPath(relativePath: string): boolean {
  return getFilePreviewKind(relativePath) === "image";
}

/** SVG 是 UTF-8 文本，走文本读取；其余位图走 base64 二进制读取 */
export function isBinaryImagePreviewPath(relativePath: string): boolean {
  return isImagePreviewPath(relativePath) && getExtension(relativePath) !== "svg";
}

export function isSvgPreviewPath(relativePath: string): boolean {
  return getExtension(relativePath) === "svg";
}

export function isHtmlPreviewPath(relativePath: string): boolean {
  return HTML_EXTENSIONS.has(getExtension(relativePath));
}

export function isMarkdownPath(relativePath: string): boolean {
  const ext = getExtension(relativePath);
  return ext === "md" || ext === "markdown";
}

export function getImageMimeType(relativePath: string): string | null {
  const extension = getExtension(relativePath);
  return IMAGE_MIME_BY_EXTENSION[extension] ?? null;
}

export function getFileNameFromPath(relativePath: string): string {
  return relativePath.split(/[/\\]/).pop() || relativePath;
}

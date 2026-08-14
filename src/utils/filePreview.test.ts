import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getFilePreviewKind,
  getImageMimeType,
  isBinaryImagePreviewPath,
  isHtmlPreviewPath,
  isMarkdownPath,
} from "./filePreview.ts";

test("text/图片预览类型按扩展名判定", () => {
  assert.equal(getFilePreviewKind("src/index.ts"), "text");
  assert.equal(getFilePreviewKind("assets/logo.png"), "image");
  assert.equal(getFilePreviewKind("docs/icon.svg"), "image");
});

test("SVG 走文本读取，其余图片走 base64 二进制读取", () => {
  assert.equal(isBinaryImagePreviewPath("a.png"), true);
  assert.equal(isBinaryImagePreviewPath("a.svg"), false);
});

test("HTML 预览按钮只在 html/htm 显示", () => {
  assert.equal(isHtmlPreviewPath("page.html"), true);
  assert.equal(isHtmlPreviewPath("page.HTM"), true);
  assert.equal(isHtmlPreviewPath("page.css"), false);
});

test("Markdown 判定不区分大小写", () => {
  assert.equal(isMarkdownPath("README.MD"), true);
  assert.equal(isMarkdownPath("notes.markdown"), true);
  assert.equal(isMarkdownPath("main.ts"), false);
});

test("图片 MIME 映射常用格式", () => {
  assert.equal(getImageMimeType("photo.JPG"), "image/jpeg");
  assert.equal(getImageMimeType("icon.ico"), "image/x-icon");
  assert.equal(getImageMimeType("vector.svg"), "image/svg+xml");
  assert.equal(getImageMimeType("data.txt"), null);
});

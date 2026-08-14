import { test } from "node:test";
import assert from "node:assert/strict";
import { monacoLanguageForPath } from "./monaco.ts";

test("常见扩展名映射到 monaco 语言 id", () => {
  assert.equal(monacoLanguageForPath("src/main.ts"), "typescript");
  assert.equal(monacoLanguageForPath("src/App.tsx"), "typescript");
  assert.equal(monacoLanguageForPath("scripts/build.mjs"), "javascript");
  assert.equal(monacoLanguageForPath("style.scss"), "scss");
  assert.equal(monacoLanguageForPath("page.html"), "html");
  assert.equal(monacoLanguageForPath("main.rs"), "rust");
  assert.equal(monacoLanguageForPath("go.mod"), "plaintext");
});

test("无扩展名与未知类型回退 plaintext", () => {
  assert.equal(monacoLanguageForPath("LICENSE"), "plaintext");
  assert.equal(monacoLanguageForPath("data.unknownext"), "plaintext");
});

test("Dockerfile 按文件名映射", () => {
  assert.equal(monacoLanguageForPath("deploy/Dockerfile"), "dockerfile");
});

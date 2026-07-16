import assert from "node:assert/strict";
import test from "node:test";
import { isEditableTextFile } from "./textFiles.ts";

test("allows common text extensions", () => {
  assert.equal(isEditableTextFile("src/App.tsx"), true);
  assert.equal(isEditableTextFile("README.md"), true);
  assert.equal(isEditableTextFile("package.json"), true);
  assert.equal(isEditableTextFile("config.yaml"), true);
  assert.equal(isEditableTextFile("main.rs"), true);
});

test("allows common text basenames without extension", () => {
  assert.equal(isEditableTextFile("Dockerfile"), true);
  assert.equal(isEditableTextFile("Makefile"), true);
  assert.equal(isEditableTextFile(".gitignore"), true);
  assert.equal(isEditableTextFile(".env"), true);
});

test("rejects directories and binary-looking files", () => {
  assert.equal(isEditableTextFile("src", true), false);
  assert.equal(isEditableTextFile("image.png"), false);
  assert.equal(isEditableTextFile("archive.zip"), false);
  assert.equal(isEditableTextFile("app.exe"), false);
  assert.equal(isEditableTextFile("unknownfile"), false);
});

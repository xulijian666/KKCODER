import assert from "node:assert/strict";
import {
  captureUserInputData,
  deriveSessionTitleFromInput,
} from "../src/utils/sessionTitle.ts";

const chineseCapture = captureUserInputData("", "帮我修复自动命名");
assert.equal(chineseCapture.buffer, "帮我修复自动命名");
assert.equal(chineseCapture.submitted, false);

const submittedCapture = captureUserInputData("", "第一句话\r");
assert.equal(submittedCapture.submitted, true);
assert.equal(submittedCapture.submittedInput, "第一句话");

assert.equal(deriveSessionTitleFromInput("> 帮我修复自动命名"), "帮我修复自动命名");
assert.equal(
  deriveSessionTitleFromInput("⏵⏵ bypass permissions on (shift+tab to cycle)"),
  null
);

console.log("sessionTitle tests passed");

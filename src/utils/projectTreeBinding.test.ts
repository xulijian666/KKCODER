import assert from "node:assert/strict";
import test from "node:test";
import {
  reconcileProjectTreeBindingMode,
  resolveOtherSplitSessionId,
  resolveTreeBoundSessionId,
} from "./projectTreeBinding.ts";

const pair = { primaryId: "left", secondaryId: "right" };

test("resolveTreeBoundSessionId follows focus by default", () => {
  assert.equal(
    resolveTreeBoundSessionId("follow-focus", "right", pair),
    "right",
  );
  assert.equal(resolveTreeBoundSessionId("follow-focus", "left", null), "left");
});

test("resolveTreeBoundSessionId pins to split slots", () => {
  assert.equal(resolveTreeBoundSessionId("primary", "right", pair), "left");
  assert.equal(resolveTreeBoundSessionId("secondary", "left", pair), "right");
});

test("reconcileProjectTreeBindingMode collapses pin when not dual", () => {
  assert.equal(reconcileProjectTreeBindingMode("primary", false), "follow-focus");
  assert.equal(reconcileProjectTreeBindingMode("secondary", true), "secondary");
});

test("resolveOtherSplitSessionId returns the opposite pane", () => {
  assert.equal(resolveOtherSplitSessionId("left", pair), "right");
  assert.equal(resolveOtherSplitSessionId("right", pair), "left");
  assert.equal(resolveOtherSplitSessionId("left", null), null);
});

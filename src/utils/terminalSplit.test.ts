import assert from "node:assert/strict";
import test from "node:test";
import {
  clampSplitRatio,
  parsePersistedTerminalSplitState,
  pickSplitCompanionSessionId,
  placeSessionBesideInTabOrder,
  reconcilePairWithOpenTabs,
  resolvePairAfterActivate,
  resolvePairAfterClose,
  resolveVisibleSessionIds,
  serializeTerminalSplitState,
  SPLIT_RATIO_DEFAULT,
} from "./terminalSplit.ts";

test("clampSplitRatio keeps values inside safe band", () => {
  assert.equal(clampSplitRatio(0.5), 0.5);
  assert.ok(clampSplitRatio(0.01) >= 0.22);
  assert.ok(clampSplitRatio(0.99) <= 0.78);
  assert.equal(clampSplitRatio(Number.NaN), SPLIT_RATIO_DEFAULT);
});

test("resolveVisibleSessionIds covers single and dual", () => {
  assert.deepEqual(resolveVisibleSessionIds("a", null), ["a"]);
  assert.deepEqual(
    resolveVisibleSessionIds("a", { primaryId: "a", secondaryId: "b" }),
    ["a", "b"],
  );
});

test("resolvePairAfterActivate only replaces primary (right stays fixed)", () => {
  const pair = { primaryId: "a", secondaryId: "b" };
  assert.deepEqual(resolvePairAfterActivate(pair, "a", "a"), pair);
  assert.deepEqual(resolvePairAfterActivate(pair, "a", "b"), pair);
  assert.deepEqual(resolvePairAfterActivate(pair, "a", "c"), {
    primaryId: "c",
    secondaryId: "b",
  });
  // 即使当前焦点在右侧，第三个会话也只进左侧
  assert.deepEqual(resolvePairAfterActivate(pair, "b", "c"), {
    primaryId: "c",
    secondaryId: "b",
  });
});

test("resolvePairAfterClose collapses to single", () => {
  const pair = { primaryId: "a", secondaryId: "b" };
  assert.deepEqual(resolvePairAfterClose(pair, "a"), {
    pair: null,
    nextActiveId: "b",
  });
  assert.deepEqual(resolvePairAfterClose(pair, "b"), {
    pair: null,
    nextActiveId: "a",
  });
  assert.deepEqual(resolvePairAfterClose(pair, "c"), {
    pair,
    nextActiveId: null,
  });
});

test("reconcilePairWithOpenTabs drops incomplete pairs", () => {
  const pair = { primaryId: "a", secondaryId: "b" };
  assert.deepEqual(reconcilePairWithOpenTabs(pair, ["a", "b", "c"]), pair);
  assert.equal(reconcilePairWithOpenTabs(pair, ["a"]), null);
  assert.equal(reconcilePairWithOpenTabs(pair, ["b"]), null);
});

test("pickSplitCompanionSessionId prefers neighbor then preferred", () => {
  assert.equal(pickSplitCompanionSessionId(["a", "b", "c"], "b"), "c");
  assert.equal(pickSplitCompanionSessionId(["a", "b", "c"], "c"), "b");
  assert.equal(pickSplitCompanionSessionId(["a", "b"], "a", "b"), "b");
  assert.equal(pickSplitCompanionSessionId(["a"], "a"), null);
});

test("placeSessionBesideInTabOrder moves secondary next to anchor", () => {
  assert.deepEqual(placeSessionBesideInTabOrder(["a", "b", "c", "d"], "a", "d"), [
    "a",
    "d",
    "b",
    "c",
  ]);
  assert.deepEqual(placeSessionBesideInTabOrder(["a", "b", "c"], "b", "a"), [
    "b",
    "a",
    "c",
  ]);
  assert.deepEqual(placeSessionBesideInTabOrder(["a", "b"], "a", "b"), ["a", "b"]);
  assert.deepEqual(placeSessionBesideInTabOrder(["a", "b"], "a", "c"), ["a", "c", "b"]);
  assert.deepEqual(placeSessionBesideInTabOrder(["a", "b"], "a", "a"), ["a", "b"]);
});

test("persist round-trip keeps orientation and ratio", () => {
  const raw = serializeTerminalSplitState({
    primaryId: "p1",
    secondaryId: "p2",
    orientation: "vertical",
    ratio: 0.4,
    focusedSessionId: "p2",
  });
  const parsed = parsePersistedTerminalSplitState(raw);
  assert.deepEqual(parsed, {
    primaryId: "p1",
    secondaryId: "p2",
    orientation: "vertical",
    ratio: 0.4,
    focusedSessionId: "p2",
  });
  assert.equal(parsePersistedTerminalSplitState("not-json"), null);
});

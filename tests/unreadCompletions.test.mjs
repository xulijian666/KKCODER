import assert from "node:assert/strict";
import {
  addUnreadCompletion,
  getUnreadCompletionCount,
  markSessionRead,
} from "../src/utils/unreadCompletions.ts";

assert.deepEqual(addUnreadCompletion([], "session-2", "session-1"), ["session-2"]);
assert.deepEqual(addUnreadCompletion(["session-2"], "session-2", "session-1"), ["session-2"]);
assert.deepEqual(addUnreadCompletion([], "session-1", "session-1"), []);
assert.deepEqual(addUnreadCompletion([], "session-1", "session-1", false), ["session-1"]);
assert.deepEqual(markSessionRead(["session-2", "session-3"], "session-2"), ["session-3"]);
assert.equal(getUnreadCompletionCount(["session-3"]), 1);

console.log("unreadCompletions tests passed");

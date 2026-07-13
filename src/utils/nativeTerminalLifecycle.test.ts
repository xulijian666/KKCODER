import assert from "node:assert/strict";
import test from "node:test";

test("reuses an in-flight spawn across StrictMode replay and closes only on the real release", async () => {
  const { createNativeTerminalLifecycle } = await import("./nativeTerminalLifecycle.ts");

  let resolveSpawn!: () => void;
  let spawnCount = 0;
  let closeCount = 0;
  const spawnReady = new Promise<void>((resolve) => {
    resolveSpawn = resolve;
  });
  const lifecycle = createNativeTerminalLifecycle(
    () => {
      spawnCount += 1;
      return spawnReady;
    },
    async () => {
      closeCount += 1;
    },
  );

  const firstMount = lifecycle.acquire();
  const strictModeCleanup = lifecycle.release(firstMount.ticket);
  const secondMount = lifecycle.acquire();

  resolveSpawn();

  assert.equal(await firstMount.ready, false);
  assert.equal(await secondMount.ready, true);
  await strictModeCleanup;
  assert.equal(spawnCount, 1);
  assert.equal(closeCount, 0);

  await lifecycle.release(secondMount.ticket);
  assert.equal(closeCount, 1);
});

export interface NativeTerminalLease {
  ticket: number;
  ready: Promise<boolean>;
}

export interface NativeTerminalLifecycle {
  acquire: () => NativeTerminalLease;
  release: (ticket: number) => Promise<void>;
}

export const createNativeTerminalLifecycle = (
  spawn: () => Promise<void>,
  close: () => Promise<void>,
): NativeTerminalLifecycle => {
  let generation = 0;
  let spawnPromise: Promise<void> | null = null;

  return {
    acquire() {
      generation += 1;
      const ticket = generation;
      spawnPromise ??= Promise.resolve().then(spawn);

      return {
        ticket,
        ready: spawnPromise.then(() => generation === ticket),
      };
    },

    async release(ticket) {
      const pendingSpawn = spawnPromise;
      if (!pendingSpawn) return;

      try {
        await pendingSpawn;
      } catch {
        return;
      }

      // React StrictMode immediately reacquires the same component after cleanup.
      // Yield once so that replay can invalidate this release before closing the HWND.
      await Promise.resolve();
      if (generation !== ticket || spawnPromise !== pendingSpawn) return;

      await close();
      spawnPromise = null;
    },
  };
};

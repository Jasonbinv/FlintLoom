import { watch, type FSWatcher } from "node:fs";
import { basename, resolve } from "node:path";
import { isHiddenRelPath } from "@flintloom/tools";

export type FileSyncPayload = {
  generation: number;
  dirs: string[];
  files: string[];
};

export type FileWatch = {
  generation(): number;
  wait(n: number, signal: AbortSignal): Promise<FileSyncPayload>;
  setRoot(root: string): void;
  close(): void;
};

type Waiter = {
  resolve: (payload: FileSyncPayload) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onAbort: () => void;
  signal: AbortSignal;
};

function posixRel(filename: string): string {
  return filename.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function isOfficeLock(rel: string): boolean {
  return basename(rel).startsWith("~$");
}

function dirsForFile(rel: string): string[] {
  const dirs = new Set<string>(["."]);
  const parts = rel.split("/").filter(Boolean);
  let acc = "";
  for (let i = 0; i < parts.length - 1; i++) {
    acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
    dirs.add(acc);
  }
  return [...dirs];
}

function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

export function createFileWatch(opts: {
  root: string;
  debounceMs?: number;
  waitTimeoutMs?: number;
}): FileWatch {
  const debounceMs = opts.debounceMs ?? 300;
  const waitTimeoutMs = opts.waitTimeoutMs ?? 20_000;
  let root = resolve(opts.root);
  let current = 0;
  let watcher: FSWatcher | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const dirtyDirs = new Set<string>();
  const dirtyFiles = new Set<string>();
  const waiters = new Set<Waiter>();

  function stopWatcher(): void {
    watcher?.removeAllListeners();
    try {
      watcher?.close();
    } catch {
      // ignore
    }
    watcher = undefined;
  }

  function rejectWaiters(): void {
    for (const waiter of [...waiters]) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      clearTimeout(waiter.timer);
      waiter.reject(abortError());
    }
    waiters.clear();
  }

  function flush(): void {
    debounceTimer = undefined;
    if (dirtyDirs.size === 0 && dirtyFiles.size === 0) return;
    current += 1;
    const payload: FileSyncPayload = {
      generation: current,
      dirs: [...dirtyDirs],
      files: [...dirtyFiles],
    };
    dirtyDirs.clear();
    dirtyFiles.clear();
    for (const waiter of [...waiters]) {
      waiter.signal.removeEventListener("abort", waiter.onAbort);
      clearTimeout(waiter.timer);
      waiter.resolve(payload);
    }
    waiters.clear();
  }

  function noteChange(relRaw: string | null): void {
    if (relRaw === null || relRaw.length === 0) {
      dirtyDirs.add(".");
    } else {
      const rel = posixRel(relRaw);
      if (rel.length === 0) {
        dirtyDirs.add(".");
      } else if (isHiddenRelPath(rel) || isOfficeLock(rel)) {
        return;
      } else {
        for (const dir of dirsForFile(rel)) dirtyDirs.add(dir);
        dirtyFiles.add(rel);
      }
    }
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(flush, debounceMs);
  }

  function startWatcher(): void {
    stopWatcher();
    try {
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        noteChange(filename);
      });
      watcher.on("error", () => {
        stopWatcher();
      });
    } catch {
      watcher = undefined;
    }
  }

  startWatcher();

  return {
    generation() {
      return current;
    },
    wait(n, signal) {
      if (n !== current) {
        return Promise.resolve({
          generation: current,
          dirs: ["."],
          files: [],
        });
      }
      if (signal.aborted) return Promise.reject(abortError());
      return new Promise<FileSyncPayload>((resolveP, rejectP) => {
        const onAbort = () => {
          waiters.delete(waiter);
          clearTimeout(waiter.timer);
          rejectP(abortError());
        };
        const waiter: Waiter = {
          resolve: resolveP,
          reject: rejectP,
          signal,
          timer: setTimeout(() => {
            waiters.delete(waiter);
            signal.removeEventListener("abort", onAbort);
            resolveP({ generation: current, dirs: [], files: [] });
          }, waitTimeoutMs),
          onAbort,
        };
        signal.addEventListener("abort", onAbort, { once: true });
        waiters.add(waiter);
      });
    },
    setRoot(nextRoot) {
      const resolved = resolve(nextRoot);
      if (resolved === root) return;
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      debounceTimer = undefined;
      dirtyDirs.clear();
      dirtyFiles.clear();
      current = 0;
      rejectWaiters();
      root = resolved;
      startWatcher();
    },
    close() {
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      debounceTimer = undefined;
      dirtyDirs.clear();
      dirtyFiles.clear();
      rejectWaiters();
      stopWatcher();
    },
  };
}

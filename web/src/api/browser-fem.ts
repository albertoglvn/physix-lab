type WorkerReply = { id: number; payload: unknown };
type Pending = {
  resolve: (payload: unknown) => void;
  reject: (reason: unknown) => void;
};
const pending = new Map<number, Pending>();
let worker: Worker | undefined;
let sequence = 0;

function resetWorker(current: Worker, message: string) {
  if (worker !== current) return;
  worker = undefined;
  current.terminate();
  const error = new Error(message);
  for (const request of pending.values()) request.reject(error);
}

function solverWorker(): Worker {
  if (worker) return worker;
  const current = new Worker(new URL("./fem-worker.ts", import.meta.url), {
    type: "module",
  });
  worker = current;
  current.onmessage = ({ data }: MessageEvent<WorkerReply>) =>
    pending.get(data.id)?.resolve(data.payload);
  const onFailure = () =>
    resetWorker(
      current,
      "The browser solver stopped. Try the calculation again.",
    );
  current.onerror = onFailure;
  current.onmessageerror = onFailure;
  return current;
}

export function runBrowserFem(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }

    const current = solverWorker();
    const id = ++sequence;
    const clean = () => {
      pending.delete(id);
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      clean();
      reject(signal?.reason);
    };
    const timeout = window.setTimeout(() => {
      resetWorker(
        current,
        "The browser solver took too long. Try again with a smaller search budget.",
      );
    }, 180_000);
    pending.set(id, {
      resolve(payload) {
        clean();
        resolve(payload);
      },
      reject(error) {
        clean();
        reject(error);
      },
    });
    signal?.addEventListener("abort", abort, { once: true });
    try {
      current.postMessage({ id, path, body });
    } catch (error) {
      clean();
      reject(error);
    }
  });
}

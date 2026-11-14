import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Sent = { id: number; path: string; body: unknown };

class WorkerStub {
  static instances: WorkerStub[] = [];
  messages: Sent[] = [];
  onmessage?: (event: { data: { id: number; payload: unknown } }) => void;
  onerror?: () => void;
  terminate = vi.fn();

  constructor() {
    WorkerStub.instances.push(this);
  }

  postMessage(message: Sent) {
    this.messages.push(message);
  }

  reply(index: number, payload: unknown) {
    this.onmessage?.({ data: { id: this.messages[index].id, payload } });
  }
}

beforeEach(() => {
  vi.resetModules();
  WorkerStub.instances = [];
  vi.stubGlobal("Worker", WorkerStub);
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser FEM transport", () => {
  it("uses one worker and matches responses to their original requests", async () => {
    const { runBrowserFem } = await import("./browser-fem");
    const first = runBrowserFem("/api/verify", { case: "plate" });
    const second = runBrowserFem("/api/optimize", { case: "bracket" });
    const [worker] = WorkerStub.instances;
    expect(WorkerStub.instances).toHaveLength(1);
    expect(worker.messages.map(({ path }) => path)).toEqual([
      "/api/verify",
      "/api/optimize",
    ]);

    worker.reply(1, { selected: "bracket" });
    worker.reply(0, { source: "fem" });

    await expect(first).resolves.toEqual({ source: "fem" });
    await expect(second).resolves.toEqual({ selected: "bracket" });
  });

  it("fails outstanding jobs and starts a new worker after a crash", async () => {
    const { runBrowserFem } = await import("./browser-fem");
    const initial = runBrowserFem("/api/verify", {});
    const first = WorkerStub.instances[0];
    first.onerror?.();
    await expect(initial).rejects.toThrow("solver stopped");
    expect(first.terminate).toHaveBeenCalledOnce();

    const retry = runBrowserFem("/api/verify", {});
    const second = WorkerStub.instances[1];
    second.reply(0, { source: "fem" });
    await expect(retry).resolves.toEqual({ source: "fem" });
  });

  it("ignores a result for a request the caller has aborted", async () => {
    const { runBrowserFem } = await import("./browser-fem");
    const controller = new AbortController();
    const request = runBrowserFem("/api/verify", {}, controller.signal);
    const worker = WorkerStub.instances[0];
    controller.abort();
    worker.reply(0, { source: "fem" });
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});

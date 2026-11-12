/**
 * Simulates sweep points off the main thread. Each message is one point; the reply carries
 * the clean metric, and the page adds any synthetic noise.
 */

import { runSweepPoint } from "./sweep";
import type { SweepTask } from "./sweepPool";

self.onmessage = async (
  event: MessageEvent<{ id: number; task: SweepTask }>,
) => {
  const { id, task } = event.data;
  try {
    const point = await runSweepPoint(task.scene, task.spec, task.index);
    self.postMessage({ id, point });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

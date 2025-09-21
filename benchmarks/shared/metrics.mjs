/* eslint-disable no-undef */
import v8 from "node:v8";

export function attachMetricsRoute(fastify, {
  startNs,
  variantLabel,
  counts
}) {
  fastify.get("/__bench/metrics", async () => {
    global.gc?.();

    const mem = process.memoryUsage();
    const heap = v8.getHeapStatistics();
    const ru = typeof process.resourceUsage === "function" ? process.resourceUsage() : {};
    const readyNs = Number(process.hrtime.bigint() - startNs);

    return {
      readyNs,
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        heapLimit: heap.heap_size_limit
      },
      resourceUsage: {
        userCPU: ru.userCPUTime,
        systemCPU: ru.systemCPUTime,
        maxRSS: ru.maxRSS
      },
      variant: variantLabel,
      count: counts,
      pid: process.pid
    };
  });
}

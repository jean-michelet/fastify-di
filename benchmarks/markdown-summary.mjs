const MB = 1024 * 1024;
const NS_PER_MS = 1e6;

function nsToMs(ns) {
  return ns / NS_PER_MS;
}

function fmt(num, digits = 2) {
  return typeof num === "number"
    ? num.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : String(num);
}

function pctDiff(newVal, baseVal) {
  if (!isFinite(newVal) || !isFinite(baseVal) || baseVal === 0) return 0;
  return ((newVal - baseVal) / baseVal) * 100;
}

export function buildMarkdownSummary(allResults, options = {}) {
  const {
    nativeName = "fastify-native",
    diName = "fastify-di",
    connections,
    durationSeconds,
    pipelining,
    warmupSeconds,
    nbDomains,
    nbServicesPerDomain,
  } = options;

  // group by scenario id
  /** @type {Record<string, Record<string, any>>} */
  const group = {};
  for (const r of allResults) {
    group[r.scenario] ||= {};
    group[r.scenario][r.variant] = r;
  }

  let md = "";
  md += `# Benchmark Summary\n\n`;
  md += `*connections=${connections}, duration=${durationSeconds}s, pipelining=${pipelining}, warmup=${warmupSeconds}s*\n\n`;

  md += `Domains=${nbDomains}, Services per domain=${nbServicesPerDomain}, Total services=${nbDomains * nbServicesPerDomain}\n\n`;

  for (const scenarioId of Object.keys(group)) {
    const bucket = group[scenarioId];
    const native = bucket[nativeName];
    const di = bucket[diName];

    if (!native || !di) {
      md += `## ${scenarioId}\nMissing one of the variants; found: ${Object.keys(bucket).join(", ")}\n\n`;
      continue;
    }

    const bootNativeMs = nsToMs(native.idle.readyNs);
    const bootDiMs = nsToMs(di.idle.readyNs);

    const reqNative = native.perf.requests.average;
    const reqDi = di.perf.requests.average;

    const p99Native = native.perf.latency.p99;
    const p99Di = di.perf.latency.p99;

    const rssNativeMB = native.after.memory.rss / MB;
    const rssDiMB = di.after.memory.rss / MB;

    // deltas
    const dReq = pctDiff(reqDi, reqNative);
    const dP99 = pctDiff(p99Di, p99Native);
    const dBoot = pctDiff(bootDiMs, bootNativeMs);
    const dRss = pctDiff(rssDiMB, rssNativeMB);

    md += `## ${scenarioId}\n\n`;
    md += `| Metric | ${nativeName} | ${diName} | Δ (DI vs Native) |\n`;
    md += `|---|---:|---:|---:|\n`;
    md += `| **Throughput (req/s avg)** | ${fmt(reqNative, 0)} | ${fmt(reqDi, 0)} | ${fmt(dReq, 2)}% |\n`;
    md += `| **Latency p99 (ms)** | ${fmt(p99Native, 2)} | ${fmt(p99Di, 2)} | ${fmt(dP99, 2)}% |\n`;
    md += `| **Boot time (ms)** | ${fmt(bootNativeMs, 2)} | ${fmt(bootDiMs, 2)} | ${fmt(dBoot, 2)}% |\n`;
    md += `| **RSS after run (MB)** | ${fmt(rssNativeMB, 2)} | ${fmt(rssDiMB, 2)} | ${fmt(dRss, 2)}% |\n`;
    md += `\n`;
  }

  return md;
}

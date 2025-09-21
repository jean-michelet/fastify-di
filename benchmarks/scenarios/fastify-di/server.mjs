import { createApp, createModule, createProvider } from "fastify-di";
import {
  PORT,
  LOG_LEVEL,
  NUMBER_OF_DOMAINS,
  SERVICES_PER_DOMAIN,
} from "../../shared/config.mjs";
import { attachMetricsRoute } from "../../shared/metrics.mjs";
import { createServiceSample } from "../../shared/fixtures.mjs";

// eslint-disable-next-line no-undef
const startNs = process.hrtime.bigint();

function createServiceProvider(domainIndex, serviceIndex) {
  const name = `svc-${domainIndex}-${serviceIndex}`;
  return createProvider({
    name: `svc-${domainIndex}-${serviceIndex}`,
    expose: () => createServiceSample(name),
  });
}

function createHttpModule(domainIndex) {
  const deps = Object.fromEntries(
    Array.from({ length: SERVICES_PER_DOMAIN }, (_, s) => [
      `svc-${domainIndex}-${s}`,
      createServiceProvider(domainIndex, s),
    ]),
  );

  return createModule({
    name: `http-${domainIndex}`,
    deps,
    accessFastify: ({ fastify, deps }) => {
      fastify.get(`/unit-${domainIndex}/ping`, async () => {
        let accumulator = 1;
        for (let s = 0; s < SERVICES_PER_DOMAIN; s++) {
          const svc = deps[`svc-${domainIndex}-${s}`];
          svc.increment();
        }
        return { pong: true, accumulator };
      });
    },
  });
}

function createMetricsModule() {
  return createModule({
    name: "metrics",
    accessFastify: ({ fastify }) => {
      attachMetricsRoute(fastify, {
        startNs,
        variantLabel: "fastify-di:baseline",
        counts: {
          domains: NUMBER_OF_DOMAINS,
          servicesPerDomain: SERVICES_PER_DOMAIN,
          totalServices: NUMBER_OF_DOMAINS * SERVICES_PER_DOMAIN,
        },
      });
    },
  });
}

// Assemble root
const domainModules = Array.from({ length: NUMBER_OF_DOMAINS }, (_, d) =>
  createHttpModule(d),
);

const root = createModule({
  name: "root",
  subModules: [createMetricsModule(), ...domainModules],
});

const app = await createApp({
  root,
  serverOptions: { logger: { level: LOG_LEVEL } },
});

await app.listen({ port: PORT, host: "127.0.0.1" });

// eslint-disable-next-line no-undef
process.on("SIGTERM", async () => {
  await app.close();
  // eslint-disable-next-line no-undef
  process.exit(0);
});

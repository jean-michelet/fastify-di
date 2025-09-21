import Fastify from "fastify";
import fp from "fastify-plugin";
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
const app = Fastify({ logger: { level: LOG_LEVEL } });

function createServicePlugin(domainIndex, serviceIndex) {
  const name = `svc-${domainIndex}-${serviceIndex}`;
  return fp(
    async (instance) => {
      instance.decorate(name, createServiceSample(name));
    },
    { name },
  );
}

function createHttpPlugin(domainIndex) {
  return fp(
    async (instance) => {
      for (let s = 0; s < SERVICES_PER_DOMAIN; s++) {
        await instance.register(createServicePlugin(domainIndex, s));
      }

      instance.get(`/unit-${domainIndex}/ping`, async () => {
        let accumulator = 1;
        for (let s = 0; s < SERVICES_PER_DOMAIN; s++) {
          const svc = instance[`svc-${domainIndex}-${s}`];
          svc.increment();
        }
        return { pong: true, accumulator };
      });
    },
    { name: `http-${domainIndex}`, encapsulate: true },
  );
}

// Because we create metricsModule with fastify-di
function createMetricsPlugin() {
  return async (instance) => {
    attachMetricsRoute(instance, {
      startNs,
      variantLabel: "fastify-native:baseline",
      counts: {
        domains: NUMBER_OF_DOMAINS,
        servicesPerDomain: SERVICES_PER_DOMAIN,
        totalServices: NUMBER_OF_DOMAINS * SERVICES_PER_DOMAIN,
      },
    });
  };
}

// Register domains
for (let d = 0; d < NUMBER_OF_DOMAINS; d++) {
  app.register(createHttpPlugin(d));
}

app.register(createMetricsPlugin());

await app.listen({ port: PORT, host: "127.0.0.1" });
// eslint-disable-next-line no-undef
process.on("SIGTERM", async () => {
  await app.close();
  // eslint-disable-next-line no-undef
  process.exit(0);
});

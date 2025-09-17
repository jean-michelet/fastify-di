import type { FastifyInstance } from "fastify";
import { Container } from "../container";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BivariantCallback<T extends (...args: any) => any> =
  { bivarianceHack: T }["bivarianceHack"];

export type ProviderLifecycle = "singleton" | "transient";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProviderAny = ProviderDef<any, any>;

export type BaseProviderDepsMap = Record<string, ProviderAny>;
export type DepValues<ProviderDepsMap extends BaseProviderDepsMap> = {
  [K in keyof ProviderDepsMap]: Awaited<
    ReturnType<ProviderDepsMap[K]["expose"]>
  >;
};

type ProviderHook<D extends BaseProviderDepsMap, V> =
  BivariantCallback<(ctx: {
    fastify: FastifyInstance;
    deps: DepValues<D>;
    value: V;
  }) => unknown | Promise<unknown>>;

export interface ProviderDef<
  ProviderDepsMap extends BaseProviderDepsMap = BaseProviderDepsMap,
  Value = unknown,
> {
  name: string;
  lifecycle: ProviderLifecycle;
  deps: ProviderDepsMap;

  expose: (deps: DepValues<ProviderDepsMap>) => Value | Promise<Value>;

  onReady?: ProviderHook<ProviderDepsMap, Value>;
  onClose?: ProviderHook<ProviderDepsMap, Value>;

  resolve: () => Promise<Value>;

  _prov?: never;
}

const kProviderId = Symbol("fastify-di:providerId");
let __seq = 0;
const nextId = () => `p${(++__seq)}`;

/**
 * This is not a predictible id.
 */
export function getProviderId(provider: ProviderAny): string {
  return (provider as never)[kProviderId];
}

export function createProvider<
  const ProviderDepsMap extends BaseProviderDepsMap,
  Value,
>(def: {
  name: string;
  lifecycle?: ProviderLifecycle;
  deps?: ProviderDepsMap;
  expose: (deps: DepValues<ProviderDepsMap>) => Value | Promise<Value>;
  onReady?: ProviderHook<ProviderDepsMap, Value>;
  onClose?: ProviderHook<ProviderDepsMap, Value>;
}): ProviderDef<ProviderDepsMap, Value> {
  const self: ProviderDef<ProviderDepsMap, Value> = {
    name: def.name,
    lifecycle: def.lifecycle ?? "singleton",
    deps: (def.deps ?? {}) as ProviderDepsMap,
    expose: def.expose,
    onReady: def.onReady,
    onClose: def.onClose,
    resolve: async () => new Container().get(self),
  };

  Object.defineProperty(self, kProviderId, {
    value: nextId(),
    enumerable: false,
  });


  return self;
}

export async function resolveDeps(container: Container, prov: ProviderAny) {
  const deps = prov.deps;
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(deps)) {
    out[k] = await container.get(p as ProviderAny);
  }

  return out;
}
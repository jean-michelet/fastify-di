# Fastify Dependency Injection

## Proposal to Adopt as an Official Package

Bring `jean-michelet/fastify-di` under the Fastify organization as an official package.
This would strengthen Fastify’s ecosystem by providing a native, well-integrated dependency injection (DI) solution
that aligns with Fastify’s model without pushing users toward external frameworks or ad-hoc patterns.

## Why under the Fastify org?

- **Native alignment.** Built around Fastify’s encapsulation, lifecycle, and plugin system.
- **Minimal.** ~1.5k LOC including tests and types.
- **Type-safe.** Leverages TypeScript for dependency contracts.
- **Improves testing.** Explicit declarations, override utilities, and type helpers to apply the Dependency Inversion Principle.
- **Community benefit.** Addresses long-standing ergonomics issues ([#5061](https://github.com/fastify/fastify/issues/5061)) that decorators alone do not resolve.
- **Quality standards.** Extensive unit tests and 100% code coverage.

### Technical cons to integrate into the org

- It is not a Fastify plugin but a package (i.e., a superset over Fastify).
- It is written in TypeScript with ESM.
- Uses `tsup` for compilation to ESM and CJS.

> **Note.** I can implement changes if they are deemed necessary.

## Why?

Fastify’s decorator system is powerful and ergonomic, yet it has some limitations.

### 1) Implicit dependencies

```ts
const dbPlugin = fp(
  async (fastify) => {
    fastify.decorate("db", { findAll: () => [{ id: 1 }] });
  },
  { name: "db" },
);

const usersPlugin = async (fastify) => {
  fastify.get("/users", async () => fastify.db.findAll());
};
```

**Problems**

- `usersPlugin` implicitly depends on `db`, but the dependency is invisible in its signature.
- TypeScript users must manually augment `FastifyInstance`, a long-standing pain point.

### 2) Encapsulation assumptions

```ts
fastify.decorate("config", { foo: true });

async function child(child) {
  child.get("/conf", () => child.config);
}

fastify.register(child);
```

The dependency is real but hidden. If reused without `config`, it fails.

### 3) Testability friction

To test a plugin with volatile dependencies in memory, you must manually recreate its decorator state:

```ts
const app = Fastify();
app.decorate("db", { findAll: () => [{ id: 1 }] });
app.register(usersPlugin);
```

This couples tests to wiring details and leads to brittle test design.

## Why not simply use Nest.js or `fastify-awilix`?

**Nest.js** provides its own DI system and is framework-agnostic.
It offers adapters for Fastify or Express, but does not leverage Fastify’s lifecycle, plugin system,
or encapsulation. This is a deliberate trade-off: you gain abstraction at the cost of alignment with Fastify’s core model.

**`fastify-awilix`** integrates the Awilix container but relies on a **service locator pattern**:

```ts
app.post("/", async (req, res) => {
  const userRepositoryForReq = req.diScope.resolve("userRepository");
  const userRepositoryForApp = app.diContainer.resolve("userRepository"); // same result
  const userService = req.diScope.resolve("userService");

  res.send({ status: "OK" });
});
```

This is not materially different from using decorators directly:

- Dependencies may still be resolved at runtime after plugin construction.
- They remain implicit in function signatures → hidden dependencies.

As a result, it does not address the core issues with Fastify decorators highlighted earlier.

## Core Concepts

**Provider.** A unit of dependency used to expose **configuration, services, or adapters** to the application.

- Declares its **deps** (other providers it relies on).
- These **deps** are injected into its `expose` function at runtime.
- `expose` returns the actual value (config object, DB client, repository, service, etc.) that other providers or modules consume.
- A provider can be `singleton` (one instance per app) or `transient` (new instance per injection).
- Providers can hook into the Fastify lifecycle (`onReady`, `onClose`).

**Module.** A higher-level building block used to group **providers and submodules**, and to wire them into Fastify routes, hooks, or plugins.

- Declares its **deps** (the providers it makes available).
- These **deps** are injected into its `accessFastify` function at runtime, alongside the encapsulated Fastify instance.
- Modules can contain **submodules**, supporting hierarchical structure.
- Each module is registered as a Fastify plugin and benefits from encapsulation (`encapsulate: false` is supported).

### Provider example

```ts
import knex from "knex";

// A DB provider
const db = createProvider({
  name: "db",
  // The method used to create the provider value
  expose: () => {
    const client = knex({
      client: "sqlite3",
      connection: {
        filename: ":memory:",
      },
    });

    return client;
  },
  onClose: async ({ value: knex }) => {
    await knex.destroy();
  },
});

// A repository provider that depends on the db
const usersRepository = createProvider({
  name: "usersRepository",
  deps: { db },
  expose: ({ db /* injected provider value (Knex instance) */ }) => ({
    async findById(id: string) {
      const row = await db("users").where({ id }).first();
      return row ?? null;
    },
  }),
});
```

### Module example

```ts
const usersModule = createModule({
  name: "users",
  deps: { usersRepository },
  // here deps contains resolved provider instances
  accessFastify: ({ fastify, deps }) => {
    fastify.get("/users/:id", async (req) => {
      return deps.usersRepository.findById(req.params.id);
    });
  },
});
```

### App construction

```ts
const root = createModule({
  name: "root",
  subModules: [usersModule, tasksModule, authModule],
});

const app = await createApp({ root });
await app.listen();
```

## Inspect the Dependency Tree

Fastify is decorated with `describeTree()` to visualize the DI graph:

```ts
console.log(app.describeTree());
```

**Example output**

```txt
🌳 mod root@m1 (encapsulate=true)
  📦 mod users@m2 (encapsulate=true)
    🔧 prov userRepo@p1 [singleton]
      🔧 prov db@p2 [singleton]
        🔧 prov config@p3 [singleton]
  📦 mod tasks@m3 (encapsulate=true)
    ...
  📦 mod auth@m4 (encapsulate=true)
    ...
```

This provides a transparent overview of dependencies.

## Dependency Inversion Principle (DIP)

Modules can depend on **contracts** rather than concrete adapters:

```ts
// Contract
interface UsersRepository {
  findById(id: string): Promise<{ id: string; name: string } | null>;
}

type UsersRepositoryContract = ProviderContract<UsersRepository>;

// Adapters
const knexUsersRepository: UsersRepositoryContract = createProvider({
  name: "usersRepository",
  deps: { db }, // real Knex db provider
  expose: ({ db }) => ({
    async findById(id) {
      const row = await db("users").where({ id }).first();
      return row ?? null;
    },
  }),
});

const fakeUsersRepository: UsersRepositoryContract = createProvider({
  name: "usersRepository",
  expose: () => ({
    async findById(id) {
      return { id, name: "Fake User" };
    },
  }),
});

// Module depending only on the contract
function createUsersModule(repo: UsersRepositoryContract) {
  return createModule({
    name: "users",
    deps: { usersRepository: repo },
    accessFastify({ fastify, deps }) {
      fastify.get("/users/:id", (req) =>
        deps.usersRepository.findById(req.params.id),
      );
    },
  });
}

// Swap adapters easily
const usersModule = createUsersModule(knexUsersRepository);
const usersModuleInMemory = createUsersModule(fakeUsersRepository);
```

## Creating Provider and Module Doubles for Tests

If you don’t want to depend on contracts but still need to replace real dependencies with fakes in tests, `fastify-dependency-injection` supports this through `withProviders`, which **deep-clones a provider or module** and lets you override some of its dependencies.

This avoids monkey-patching and keeps your dependency graph explicit while providing a safe way to build test doubles.

### Create a provider double

```ts
// A repository depending on a real db
const usersRepository = createProvider({
  name: "usersRepository",
  deps: { db },
  expose: ({ db }) => ({
    async findById(id: string) {
      const rows = await db.query("SELECT * FROM users WHERE id = ?", [id]);
      return rows[0] ?? null;
    },
  }),
});

const fakeDb = createProvider({
  name: "db",
  expose: () => ({
    async query(sql: string) {
      return [{ id: "123", name: "Fake User" }];
    },
  }),
});

// Clone and override the db dependency with a fake
const usersRepositoryDouble = usersRepository.withProviders((deps) => ({
  ...deps,
  db: fakeDb,
}));
```

### Cloning a module

```ts
// A module with a repository using a real db
const usersModule = createModule({
  name: "users",
  deps: {
    usersRepository: knexUsersRepository,
  },
  accessFastify({ fastify, deps }) {
    fastify.get("/users/:id", async (req) => {
      return deps.usersRepository.findById(req.params.id);
    });
  },
});

// Create a double with a fake repository
const fakeUsersRepository = createProvider({
  name: "usersRepository",
  expose: () => ({
    findById: async (id: string) => ({ id, name: "Fake User" }),
  }),
});

const usersModuleDouble = usersModule.withProviders((deps) => ({
  ...deps,
  usersRepository: fakeUsersRepository,
}));

// Test 100% in-memory
const app = await createApp({ root: usersModuleDouble });
const res = await app.inject({ method: "GET", url: "/users/123" });

console.log(res.json()); // { id: "123", name: "Fake User" }
```

### Type safety

`withProviders` is **fully type-checked**:

```ts
// error: wrong type for db
usersRepository.withProviders((deps) => ({ ...deps, db: 123 }));
```

This ensures your test doubles **mirror the real dependency graph**, so your modules and providers remain structurally valid and type-safe even under test conditions.

## Next steps

Features:

- scoped providers (resolution per request)
- implementing a strict mode to help developpers doing things properly
- allow to retrieve fastify `ready` or not

A high-value follow-up would be to recreate the Fastify demo using this package, enabling a comparative test suite for:

- Overall performance
- Memory consumption
- Developer ergonomics
- Potential edge cases or integration issues

If the organization has a formal process for “experimental” features, this package is a strong candidate to proceed through such a phase.

# Anticipated Concerns Around Safety

### Do providers introduce hidden dependencies?

No. Providers must explicitly declare their `deps`. When the container instantiates a provider, it 
recursively resolves all declared dependencies by calling `container.get()` on them.

This means:

- If a dependency is not listed in `deps`, it cannot be injected.
- Every provider’s dependencies are explicit in its definition.
- The DI graph can be visualized at any point with `fastify.describeTree()`, which traverses modules and providers and prints the full structure.

As a result, hidden or “magical” dependencies cannot appear unless the tree is deliberately tampered with.

### Can circular dependencies occur?

Not through the public API. Providers are resolved top-down:

- `Container.get()` first checks whether the provider is singleton or transient.
- To instantiate a provider, `instantiate()` recursively resolves its dependencies before calling `expose()`.

Because `createProvider` requires that dependencies be other providers, and because the resolution is a 
direct recursive call, a true cycle would trigger infinite recursion. 
But you cannot actually build such a cycle unless you manually mutate the provider tree after creation.

### Example: Attempt to Create a Circular Reference

With a **classic DI container** (like in NestJS), you can easily wire services in a 
cycle — the framework only detects it later, during runtime resolution:

```ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class A {
  constructor(private readonly b: B) {}
}

@Injectable()
export class B {
  constructor(private readonly a: A) {}
}

// NestJS will throw an exception at runtime.
@Module({
  providers: [A, B],
})
export class AppModule {}
```

With `fastify-di`, providers must reference other providers that are already declared.
It does immediately prevents cycles:

```ts
const A = createProvider({
  name: "A",
  deps: { B }, 
  // Error: Variable 'B' is used before being assigned.
  expose: ({ B }) => ({}),
});

const B = createProvider({
  name: "B",
  deps: { A },
  expose: ({ A }) => ({}),
});
```

Because providers are plain constants, you cannot wire `A` and `B` to each other in a cycle without triggering a compile-time error.
This means circular graphs are impossible to produce without manual tampering.

### How are names and instances kept unique?

Each provider and module gets an internal ID at creation (`getProviderId`, `getModuleId`).
During `createApp()`, the system traverses the entire module tree and enforces uniqueness:
If two modules or two providers have the same `name` but different IDs, startup fails with a clear error.

This ensures there are no accidental collisions or “shadowed” providers.

### How are provider lifetimes managed?

Providers declare their lifecycle explicitly: `"singleton"` or `"transient"`.

- **Singletons** are cached in a `WeakMap` inside the `Container`. They are created once per app, then re-used.
- **Transients** are re-instantiated every time they are injected. The `expose` function is called anew, and if it returns other dependencies, you can enable `deepClone` to prevent references from leaking between injections.

This makes instance ownership and safety deterministic.

### What about immutability and accidental state sharing?

By default, providers return whatever `expose` yields. To reduce accidental mutation risks:

- Transients can be combined with `deepClone` to guarantee isolation.
- Singletons can be frozen manually or wrapped in factories.

This design lets teams decide their own trade-off between performance and immutability guarantees.

### How are resources like databases or connections disposed of?

Every provider can implement an `onClose` hook. During `fastify.close()`, the app walks all registered providers, resolves their dependencies, retrieves the provider’s instance, and calls its `onClose` handler.

This ensures external resources (DB pools, sockets, caches) are cleaned up deterministically.

⚠️ Note: For **transient** providers, `onClose` is currently shared across all instances of the provider. That means if a transient exposes multiple values during its lifetime, its `onClose` will not be called once per instance, but once for the provider as a whole. This is a limitation to be addressed in future iterations.

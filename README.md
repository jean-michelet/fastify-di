# Fastify DI

## Proposal

Bring `jean-michelet/fastify-di` under the Fastify organization as an official package.
This would strengthen Fastify’s ecosystem by offering a native, well-integrated solution
for dependency injection without forcing users into external frameworks or ad-hoc patterns.

## Why under the Fastify org?

- **Native alignment:** built around Fastify’s encapsulation, lifecycle, and plugin system.
- **Minimal:** \~1k LOC including tests and types, with no runtime overhead.
- **Type-safe:** leverages TypeScript for dependency contracts.
- **Improves testing:** explicit declarations, override utilities and type helpers to leverage the Dependency Inversion Principle.
- **Community benefit:** solves long-standing ergonomics issues ([#5061](https://github.com/fastify/fastify/issues/5061)) that decorators alone fail to address for now.
- **Quality standards:** the package has extensive unit tests and 100% code coverage.

### Technical cons to integrate into the Org

- It is not a Fastify plugin but a package, a superset of Fastify.
- It is written in TypeScript with ESM.
- Uses tsup for compilation to ESM and CJS.

I think this package is very unlikely to interest developers who do not use TypeScript.
Fastify’s demo is also written in TypeScript with ESM. I have worked on and maintained it since mid-2024, so I don’t think this is a big issue.
I can implement changes if the points raised are considered blocking.

## Why?

Fastify’s decorator system is powerful and ergonomic.
However, there are some limitations.

### 1. Implicit dependencies

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

Problems:

- `usersPlugin` implicitly depends on `db`, but the dependency is invisible in its signature.
- TypeScript users must manually augment `FastifyInstance`, a long-standing pain point.

### 2. Encapsulation assumptions

```ts
fastify.decorate("config", { foo: true });

async function child(child) {
  child.get("/conf", () => child.config);
}

fastify.register(child);
```

The dependency is real but hidden. If reused without `config`, it fails.

### 3. Testability friction

To test in-memory a plugin with volatile dependencies, you must manually recreate its decorator state:

```ts
const app = Fastify();
app.decorate("db", { findAll: () => [{ id: 1 }] });
app.register(usersPlugin);
```

This couples tests to wiring details and leads to brittle test design.

## What is `fastify-di`?

`fastify-di` makes dependencies **explicit** with providers and modules.
It integrates with Fastify’s lifecycle and encapsulation, but adds a declarative dependency graph.

- **Provider:** a unit of dependency (service, config, adapter).
  Can be singleton or transient, and can hook into the Fastify application lifecycle.
- **Module:** a group of providers and submodules that can also register routes, hooks, etc.
  Modules are registered as Fastify plugins, benefiting from encapsulation (`encapsulate: false` is supported).

### Provider Example

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

### Module Example

```ts
const usersModule = createModule({
  name: "users",
  providers: { usersRepository },
  /**
   * fastify: encapsulated Fastify instance
   * deps: Record of injected provider values
   */
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

Example output:

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

Modules can depend on **contracts** instead of concrete adapters:

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
    providers: { usersRepository: repo },
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

### Overriding for Tests

When not using contracts, dependencies can still be overridden directly.

#### Overriding a Single Provider

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

// Override the dependency with a fake db
const usersRepositoryDouble = usersRepository.override((deps) => ({
  ...deps,
  db: fakeDb,
}));
```

#### Overriding a Module’s Provider

```ts
// A module with a repository using a real db
const usersModule = createModule({
  name: "users",
  providers: {
    usersRepository: knexUsersRepository,
  },
  accessFastify({ fastify, deps }) {
    fastify.get("/users/:id", async (req) => {
      return deps.usersRepository.findById(req.params.id);
    });
  },
});

// override with a fake repository
const fakeUsersRepository = createProvider({
  name: "usersRepository",
  expose: () => ({
    findById: async (id: string) => ({ id, name: "Fake User" }),
  }),
});

const usersModuleDouble = usersModule.override((providers) => ({
  ...providers,
  usersRepository: fakeUsersRepository,
}));

// Test 100% in-memory
const app = await createApp({ root: usersModuleDouble });
const res = await app.inject({ method: "GET", url: "/users/123" });

console.log(res.json()); // { id: "123", name: "Fake User" }
```

Overrides are statically type-checked:

```ts
// error: wrong type for db
usersRepository.override((deps) => ({ ...deps, db: 123 }));
```

This helps avoid monkey-patching mocks, ensuring that your test doubles mirror the real dependency graph and that your modules and providers remain structurally valid even under test conditions.

### Next steps

A good follow-up would be to recreate the Fastify demo using this package.  
This would allow to build a battery of test comparisons:

- Overall performance
- Memory consumption
- Developer ergonomics
- Potential edge cases or integration issues

I’m not sure if the organization has a formal process for marking features as
experimental, but if so, this package could be a strong candidate to
go through such a phase.

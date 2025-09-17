import { describe, test, TestContext } from "node:test";
import { createProvider } from "../providers/providers";
import { createApp, createModule } from "..";

describe("describeTree", () => {
  test("root with child, grandchild, and sibling modules + providers", async (t: TestContext) => {
    t.plan(1);

    const grandChildProvider = createProvider({
      name: "grandChildProv",
      expose: () => ({ x: 1 }),
    });

    const siblingProvider = createProvider({
      name: "siblingProv",
      lifecycle: "transient",
      expose: () => ({ y: 2 }),
    });

    const siblingDependent = createProvider({
      name: "siblingDependent",
      deps: { siblingProvider },
      expose: ({ siblingProvider }) => ({ z: siblingProvider.y + 1 }),
    });

    const grandChild = createModule({
      name: "grandchild",
      providers: { grandChildProvider },
    });

    const child = createModule({
      name: "child",
      subModules: [grandChild],
    });

    const sibling = createModule({
      name: "sibling",
      encapsulate: false,
      providers: { siblingProvider, siblingDependent },
    });

    const root = createModule({
      name: "root",
      subModules: [child, sibling],
    });

    const app = await createApp({ root });
    const tree = app.describeTree();

    const expected = String.raw`🌳 mod root@m\d+ \(encapsulate=true\)
  📦 mod child@m\d+ \(encapsulate=true\)
    📦 mod grandchild@m\d+ \(encapsulate=true\)
      ⚙️ prov grandChildProv@p\d+ \[singleton\]
  📦 mod sibling@m\d+ \(encapsulate=false\)
    ⚙️ prov siblingProv@p\d+ \[transient\]
    ⚙️ prov siblingDependent@p\d+ \[singleton\]
`;

    // add a trailing newline for match alignment
    t.assert.match(tree + "\n", new RegExp(expected));

    await app.close();
  });
});

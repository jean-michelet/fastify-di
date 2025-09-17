import test from "node:test";
import assert from "node:assert/strict";
import { hello } from "./index.js";

test("hello() returns the greeting", () => {
  assert.equal(hello("World"), "Hello, World!");
});

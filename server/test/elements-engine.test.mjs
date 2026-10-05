import assert from "node:assert/strict";
import { test } from "node:test";

test("the uploaded Elements scenarios remain green", async () => {
  const lines = [];
  const originalLog = console.log;
  try {
    console.log = (...values) => lines.push(values.join(" "));
    await import("./run_elements_scenarios.mjs");
  } finally {
    console.log = originalLog;
  }
  assert.match(lines.join("\n"), /지원 여부[\s\S]*PASS 87 \/ FAIL 0/);
});

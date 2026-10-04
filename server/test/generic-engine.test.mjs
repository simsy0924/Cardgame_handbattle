import assert from "node:assert/strict";
import { test } from "node:test";

test("uploaded generic card engine scenarios remain green", async () => {
  const lines = [];
  const originalLog = console.log;
  let output = "";
  try {
    console.log = (...values) => lines.push(values.join(" "));
    await import("./run_generic_test.mjs");
    output = lines.join("\n");
  } finally {
    console.log = originalLog;
  }
  assert.match(output, /지원 23\/23/);
  assert.match(output, /결과: PASS 67 \/ FAIL 0/);
});

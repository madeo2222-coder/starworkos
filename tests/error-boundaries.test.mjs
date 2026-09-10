import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("application error boundaries keep runtime error details out of the UI", async () => {
  const [errorBoundary, globalErrorBoundary] = await Promise.all([
    readFile(new URL("../app/error.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/global-error.tsx", import.meta.url), "utf8"),
  ]);

  for (const boundary of [errorBoundary, globalErrorBoundary]) {
    assert.match(boundary, /^"use client";/);
    assert.match(boundary, /onClick=\{reset\}/);
    assert.doesNotMatch(boundary, /error\.message|error\.stack|digest\}/);
  }

  assert.match(globalErrorBoundary, /<html lang="ja">/);
  assert.match(globalErrorBoundary, /<body/);
});

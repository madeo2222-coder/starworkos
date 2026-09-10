import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { getExecutionErrorDisplayMessage } from "../lib/execution-errors.js";

test("execution history shows classified audit failures without raw details", () => {
  assert.equal(
    getExecutionErrorDisplayMessage(
      "[AI_PROVIDER_TIMEOUT] secret-token internal-host",
    ),
    "AI提供元から規定時間内に回答を取得できませんでした。",
  );
  assert.equal(
    getExecutionErrorDisplayMessage("[EXTERNAL_AGENT_CALLBACK_FAILED] db password=secret"),
    "外部エージェントの実行に失敗しました。",
  );

  const rawError = "password=secret connection refused internal-host";
  const userMessage = getExecutionErrorDisplayMessage(rawError);

  assert.doesNotMatch(userMessage, /secret|internal-host|connection refused/);
  assert.match(userMessage, /もう一度お試しください/);
});

test("execution history pages do not render stored error messages directly", async () => {
  const [executionsPage, employeePage] = await Promise.all([
    readFile(new URL("../app/executions/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/ai-employees/[id]/page.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  for (const page of [executionsPage, employeePage]) {
    assert.match(page, /getExecutionErrorDisplayMessage\(/);
    assert.doesNotMatch(page, /\{execution\.error_message\}/);
  }
});

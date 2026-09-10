import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const completeStepButtonUrl = new URL(
  "../app/workflows/[id]/CompleteStepButton.tsx",
  import.meta.url,
);
const loginPageUrl = new URL("../app/login/page.tsx", import.meta.url);
const autoRelayButtonUrl = new URL(
  "../app/workflows/[id]/auto-relay-button.tsx",
  import.meta.url,
);
const runAiButtonUrl = new URL(
  "../app/workflows/[id]/steps/[stepId]/run-ai-button.tsx",
  import.meta.url,
);

test("Workflow STEP completion UI does not display raw RPC errors", async () => {
  const source = await readFile(completeStepButtonUrl, "utf8");

  assert.match(source, /const rpcMessage = error\.message \?\? ""/);
  assert.doesNotMatch(source, /setMessage\(`STEPの更新に失敗しました：\$\{error\.message\}`\)/);
  assert.match(
    source,
    /STEPの更新に失敗しました。画面を更新して、もう一度お試しください。/,
  );
});

test("login UI does not display raw authentication provider errors", async () => {
  const source = await readFile(loginPageUrl, "utf8");

  assert.doesNotMatch(source, /setMessage\(`送信に失敗しました：\$\{error\.message\}`\)/);
  assert.match(
    source,
    /ログインリンクを送信できませんでした。メールアドレスを確認して、もう一度お試しください。/,
  );
});

test("Workflow auto relay does not display raw Supabase or unexpected errors", async () => {
  const source = await readFile(autoRelayButtonUrl, "utf8");

  assert.doesNotMatch(source, /workflowError\.message/);
  assert.doesNotMatch(source, /stepError\.message/);
  assert.doesNotMatch(source, /completeError\.message\s*,/);
  assert.match(source, /error instanceof AutoRelayUserError/);
  assert.match(
    source,
    /自動リレー中に予期しないエラーが発生しました。/,
  );
});

test("Workflow AI button does not display raw API, parser, or network errors", async () => {
  const source = await readFile(runAiButtonUrl, "utf8");

  assert.doesNotMatch(source, /result\.error/);
  assert.doesNotMatch(source, /error instanceof Error/);
  assert.match(source, /getRunAiFailureMessage\(response\.status\)/);
  assert.match(source, /error instanceof RunAiUserError/);
  assert.match(
    source,
    /通信状態を確認して、もう一度お試しください。/,
  );
});

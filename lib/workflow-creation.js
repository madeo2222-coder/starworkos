const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_PRIORITIES = new Set(["低", "中", "高"]);

export const WORKFLOW_CREATION_LIMITS = Object.freeze({
  title: 200,
  description: 20_000,
  ceoInstruction: 32_000,
});

export function isValidUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function getWorkflowCreationValidationError(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Workflowの入力内容が正しくありません。";
  }

  if (typeof value.title !== "string" || !value.title.trim()) {
    return "Workflow名を入力してください。";
  }

  if (value.title.length > WORKFLOW_CREATION_LIMITS.title) {
    return `Workflow名は${WORKFLOW_CREATION_LIMITS.title}文字以内で入力してください。`;
  }

  if (typeof value.description !== "string") {
    return "Workflowの説明が正しくありません。";
  }

  if (value.description.length > WORKFLOW_CREATION_LIMITS.description) {
    return `Workflowの説明は${WORKFLOW_CREATION_LIMITS.description}文字以内で入力してください。`;
  }

  if (
    typeof value.ceoInstruction !== "string" ||
    !value.ceoInstruction.trim()
  ) {
    return "CEOからの依頼内容を入力してください。";
  }

  if (
    value.ceoInstruction.length >
    WORKFLOW_CREATION_LIMITS.ceoInstruction
  ) {
    return `CEOからの依頼内容は${WORKFLOW_CREATION_LIMITS.ceoInstruction}文字以内で入力してください。`;
  }

  if (!ALLOWED_PRIORITIES.has(value.priority)) {
    return "優先度の指定が正しくありません。";
  }

  if (value.projectId !== null && !isValidUuid(value.projectId)) {
    return "プロジェクトの指定が正しくありません。";
  }

  if (value.taskId !== undefined && !isValidUuid(value.taskId)) {
    return "Taskの情報が正しくありません。";
  }

  return null;
}

export function getWorkflowCreationRpcErrorMessage(message) {
  const errorMessage = typeof message === "string" ? message : "";

  const knownErrors = [
    ["WORKFLOW_TITLE_REQUIRED", "Workflow名を入力してください。"],
    ["CEO_INSTRUCTION_REQUIRED", "CEOからの依頼内容を入力してください。"],
    ["INVALID_PRIORITY", "優先度の指定が正しくありません。"],
    ["PROJECT_NOT_FOUND", "選択したプロジェクトが見つかりません。"],
    ["TASK_ID_REQUIRED", "Taskの情報が不足しています。"],
    ["TASK_NOT_FOUND", "対象のTaskが見つかりません。"],
    [
      "TASK_STATUS_MUST_BE_NEW",
      "Workflowを生成できるのは状態がNEWのTaskだけです。",
    ],
    [
      "TASK_WORKFLOW_ALREADY_EXISTS",
      "このTaskにはすでに関連Workflowが存在します。",
    ],
    [
      "TASK_STATE_CHANGED",
      "Taskの状態が変更されました。画面を更新して、もう一度お試しください。",
    ],
    ["AI_PM_NOT_FOUND", "AI PMが登録されていません。"],
    ["AI_ARCHITECT_NOT_FOUND", "AI Architectが登録されていません。"],
    ["AI_DEVELOPER_NOT_FOUND", "AI Developerが登録されていません。"],
    ["AI_QA_NOT_FOUND", "AI QAが登録されていません。"],
    ["AI_KNOWLEDGE_NOT_FOUND", "AI Knowledgeが登録されていません。"],
  ];

  for (const [code, userMessage] of knownErrors) {
    if (errorMessage.includes(code)) {
      return userMessage;
    }
  }

  return "Workflowの作成に失敗しました。画面を更新して、もう一度お試しください。";
}

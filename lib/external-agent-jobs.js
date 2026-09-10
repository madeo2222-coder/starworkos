export const JOB_STATUSES = Object.freeze([
  "QUEUED",
  "RUNNING",
  "WAITING_HUMAN_APPROVAL",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
]);

export const SUPPORTED_PROVIDERS = Object.freeze([
  "openai_codex",
  "anthropic_claude_code",
]);

export const SUPPORTED_CAPABILITIES = Object.freeze([
  "software_development",
  "code_review",
  "repository_analysis",
]);

export const TERMINAL_STATUSES = Object.freeze(["SUCCEEDED", "FAILED", "CANCELLED"]);

export const JOB_CREATE_MAX_BODY_BYTES = 8 * 1024;

export const RESULT_FIELD_LIMITS = Object.freeze({
  externalJobId: 200,
  branchName: 255,
  pullRequestUrl: 500,
  resultSummary: 16 * 1024,
  errorCode: 128,
  errorSummary: 16 * 1024,
  timestamp: 64,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TRANSITIONS = Object.freeze({
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["WAITING_HUMAN_APPROVAL", "SUCCEEDED", "FAILED", "CANCELLED"],
  WAITING_HUMAN_APPROVAL: ["RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
});

export const HUMAN_APPROVAL_ACTIONS = Object.freeze([
  "main_merge",
  "production_deploy",
  "production_database_migration",
  "secret_or_environment_change",
  "destructive_operation",
]);

export function isValidTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function validateCreateInput(value) {
  if (!value || typeof value !== "object") return "JSON body is required.";
  const required = ["taskId", "aiEmployeeId", "provider", "capability", "repository", "baseBranch"];
  for (const key of required) {
    if (typeof value[key] !== "string" || !value[key].trim()) return `${key} is required.`;
  }
  if (!UUID_PATTERN.test(value.taskId)) return "Invalid taskId.";
  if (!UUID_PATTERN.test(value.aiEmployeeId)) return "Invalid aiEmployeeId.";
  if (!SUPPORTED_PROVIDERS.includes(value.provider)) return "Unsupported provider.";
  if (!SUPPORTED_CAPABILITIES.includes(value.capability)) return "Unsupported capability.";
  if (value.repository.length > 200 || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) return "Repository must use owner/name format.";
  if (!isValidBranchName(value.baseBranch)) return "Invalid base branch.";
  return null;
}

export function validateResultInput(value) {
  if (!value || typeof value !== "object") return "JSON body is required.";
  if (typeof value.jobId !== "string" || !UUID_PATTERN.test(value.jobId)) return "Invalid jobId.";
  if (!JOB_STATUSES.includes(value.status) || value.status === "QUEUED") return "Invalid result status.";
  if (!validOptionalString(value.externalJobId, RESULT_FIELD_LIMITS.externalJobId, { nonempty: true })) return "Invalid externalJobId.";
  if (value.branchName != null && !isValidBranchName(value.branchName)) return "Invalid branchName.";
  if (value.commitSha != null && !/^[0-9a-f]{40}$/i.test(value.commitSha)) return "commitSha must be a full SHA.";
  if (value.pullRequestNumber != null && (!Number.isSafeInteger(value.pullRequestNumber) || value.pullRequestNumber < 1)) return "Invalid pullRequestNumber.";
  if (!validOptionalString(value.pullRequestUrl, RESULT_FIELD_LIMITS.pullRequestUrl, { nonempty: true })
      || (typeof value.pullRequestUrl === "string" && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(value.pullRequestUrl))) return "Invalid pull request URL.";
  if (!validOptionalString(value.resultSummary, RESULT_FIELD_LIMITS.resultSummary)) return "Invalid resultSummary.";
  if (!validOptionalString(value.errorCode, RESULT_FIELD_LIMITS.errorCode)
      || (typeof value.errorCode === "string" && !/^[A-Z][A-Z0-9_]*$/.test(value.errorCode))) return "Invalid errorCode.";
  if (!validOptionalString(value.errorSummary, RESULT_FIELD_LIMITS.errorSummary)) return "Invalid errorSummary.";
  if (!validOptionalTimestamp(value.startedAt) || !validOptionalTimestamp(value.completedAt)) return "Invalid result timestamp.";
  return null;
}

function isValidBranchName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > RESULT_FIELD_LIMITS.branchName
      || !/^[A-Za-z0-9._\/-]+$/.test(value)) return false;
  const segments = value.split("/");
  return !value.startsWith("-")
    && !value.startsWith("/")
    && !value.endsWith("/")
    && !value.endsWith(".")
    && !value.includes("..")
    && !value.includes("//")
    && segments.every((segment) => !segment.startsWith(".") && !segment.endsWith(".lock"));
}

function validOptionalString(value, maximumLength, { nonempty = false } = {}) {
  if (value == null) return true;
  return typeof value === "string" && value.length <= maximumLength && (!nonempty || value.trim().length > 0);
}

function validOptionalTimestamp(value) {
  if (value == null) return true;
  if (typeof value !== "string" || value.length > RESULT_FIELD_LIMITS.timestamp
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

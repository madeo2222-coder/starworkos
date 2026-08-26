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
  if (!SUPPORTED_PROVIDERS.includes(value.provider)) return "Unsupported provider.";
  if (!SUPPORTED_CAPABILITIES.includes(value.capability)) return "Unsupported capability.";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository)) return "Repository must use owner/name format.";
  if (!/^(?!\/)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]+$/.test(value.baseBranch)) return "Invalid base branch.";
  return null;
}

export function validateResultInput(value) {
  if (!value || typeof value !== "object") return "JSON body is required.";
  if (typeof value.jobId !== "string" || !value.jobId) return "jobId is required.";
  if (!JOB_STATUSES.includes(value.status) || value.status === "QUEUED") return "Invalid result status.";
  if (value.commitSha != null && !/^[0-9a-f]{40}$/i.test(value.commitSha)) return "commitSha must be a full SHA.";
  if (value.pullRequestUrl != null && !/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(value.pullRequestUrl)) return "Invalid pull request URL.";
  return null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPOSITORY_PATTERN = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

export const AGENTS_API_RESULT_PATH = "/workspace/outputs/star-work-os-result.json";
export const AGENTS_API_MAX_RESULT_BYTES = 2 * 1024 * 1024;
export const AGENTS_API_MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;

export function agentsApiConfig(env = process.env) {
  if (env.EXTERNAL_AGENT_BACKEND !== "agents_api") return { ok: false, error: "AGENTS_API_BACKEND_DISABLED" };
  const apiKey = env.OPENAI_API_KEY;
  if (typeof apiKey !== "string" || apiKey.length < 20) return { ok: false, error: "AGENTS_API_NOT_CONFIGURED" };
  return { ok: true, apiKey, model: env.OPENAI_AGENTS_MODEL?.trim() || "gpt-6-astra" };
}

export function validateAgentsApiPayload(payload) {
  if (!payload || typeof payload !== "object") return "INVALID_AGENTS_API_PAYLOAD";
  const job = payload.job;
  const task = payload.task;
  if (!job || typeof job !== "object" || !UUID_PATTERN.test(job.id ?? "")) return "INVALID_AGENTS_API_JOB";
  if (job.provider !== "openai_codex" || job.capability !== "software_development") return "UNSUPPORTED_AGENTS_API_JOB";
  if (typeof job.repository !== "string" || !REPOSITORY_PATTERN.test(job.repository)) return "INVALID_AGENTS_API_REPOSITORY";
  if (typeof job.baseBranch !== "string" || !/^[A-Za-z0-9._/-]{1,200}$/.test(job.baseBranch)) return "INVALID_AGENTS_API_BASE_BRANCH";
  if (!task || typeof task !== "object" || typeof task.title !== "string" || !task.title.trim()) return "INVALID_AGENTS_API_TASK";
  return null;
}

export function buildAgentsApiInstructions(payload) {
  return [
    "You are the coding agent for STAR WORK OS.",
    "Work only inside the supplied repository snapshot. Never push to GitHub yourself.",
    "Implement the requested task, run repository tests, lint, and production build where possible.",
    "Never merge to main, deploy, migrate a production database, change production secrets, or perform destructive operations.",
    "At the end, write exactly one machine-readable JSON artifact to " + AGENTS_API_RESULT_PATH + ".",
    "The JSON must contain summary, tests, warnings, and files.",
    "Each files item must contain repository-relative path, complete UTF-8 content, and operation ('upsert' or 'delete').",
    "Include only files intentionally changed by this task. Exclude .git, node_modules, build output, credentials, and secrets.",
    "STAR WORK OS will validate the artifact and publish a non-production GitHub branch and pull request server-side.",
    "Do not claim that a GitHub branch or pull request exists; the orchestrator creates those after validating your artifact.",
    "",
    "Task title: " + payload.task.title,
    "Task content:",
    typeof payload.task.content === "string" ? payload.task.content : "",
    "",
    "Repository: " + payload.job.repository,
    "Base branch: " + payload.job.baseBranch,
  ].join("\n");
}

export function buildAgentsApiSessionRequest(payload, repositoryArchiveBase64, model = "gpt-6-astra") {
  if (typeof repositoryArchiveBase64 !== "string" || repositoryArchiveBase64.length === 0) throw new TypeError("repository archive is required");
  return {
    agent: { model, instructions: buildAgentsApiInstructions(payload) },
    environment: {
      type: "openai_hosted",
      container_size: "medium",
      network: {
        access: "restricted",
        allowed_domains: ["registry.npmjs.org", "fonts.googleapis.com", "fonts.gstatic.com"],
      },
      files: [{ type: "inline", path: "/workspace/repository.tar.gz", data: repositoryArchiveBase64 }],
      setup_commands: [{ command: "mkdir -p /workspace/repo /workspace/outputs && tar -xzf /workspace/repository.tar.gz -C /workspace/repo --strip-components=1" }, { command: "npm ci", cwd: "/workspace/repo" }],
    },
    input: "Implement the STAR WORK OS task now. Work in /workspace/repo and publish the required result artifact when finished.",
    metadata: { star_work_os_job_id: payload.job.id, star_work_os_repository: payload.job.repository },
  };
}

export function parseAgentsSessionExternalJobId(value) {
  if (typeof value !== "string") return null;
  const match = /^agents-session:([A-Za-z0-9_-]{1,200})$/.exec(value);
  return match ? match[1] : null;
}

function safeResultPath(path) {
  return typeof path === "string"
    && path.length > 0 && path.length <= 500
    && !path.startsWith("/") && !path.includes("\\")
    && !path.split("/").includes("..")
    && !path.split("/").includes(".git")
    && !path.split("/").includes("node_modules")
    && !/[\u0000-\u001f\u007f]/u.test(path);
}

export function validateAgentsResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.summary !== "string" || value.summary.length > 4000) return null;
  if (!Array.isArray(value.tests) || value.tests.length > 100 || !value.tests.every((x) => typeof x === "string" && x.length <= 1000)) return null;
  if (!Array.isArray(value.warnings) || value.warnings.length > 100 || !value.warnings.every((x) => typeof x === "string" && x.length <= 1000)) return null;
  if (!Array.isArray(value.files) || value.files.length > 200) return null;
  const files = [];
  const seen = new Set();
  for (const file of value.files) {
    if (!file || typeof file !== "object" || !safeResultPath(file.path) || seen.has(file.path)) return null;
    if (file.operation !== "upsert" && file.operation !== "delete") return null;
    if (file.operation === "upsert" && (typeof file.content !== "string" || Buffer.byteLength(file.content, "utf8") > 512 * 1024)) return null;
    if (file.operation === "delete" && file.content !== "") return null;
    seen.add(file.path);
    files.push({ path: file.path, operation: file.operation, content: file.content });
  }
  return { summary: value.summary, tests: [...value.tests], warnings: [...value.warnings], files };
}

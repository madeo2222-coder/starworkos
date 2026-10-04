const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function agentsResultBranchName(jobId) {
  if (typeof jobId !== "string" || !UUID_PATTERN.test(jobId)) return null;
  return `agents/job-${jobId}`;
}

export function buildGitTreeElements(files) {
  if (!Array.isArray(files) || files.length === 0) return null;
  return files.map((file) => file.operation === "delete"
    ? { path: file.path, mode: "100644", type: "blob", sha: null }
    : { path: file.path, mode: "100644", type: "blob", content: file.content });
}

export function buildAgentsPullRequestMetadata(jobId, taskTitle, result) {
  const branch = agentsResultBranchName(jobId);
  if (!branch || typeof taskTitle !== "string" || !taskTitle.trim() || !result || typeof result !== "object") return null;
  const title = `[Agents API] ${taskTitle.trim().slice(0, 180)}`;
  const tests = Array.isArray(result.tests) && result.tests.length
    ? result.tests.map((item) => `- ${item}`).join("\n")
    : "- No test evidence reported.";
  const warnings = Array.isArray(result.warnings) && result.warnings.length
    ? result.warnings.map((item) => `- ${item}`).join("\n")
    : "- None reported.";
  const body = [
    "## STAR WORK OS Agents API result",
    "",
    result.summary || "Coding agent completed the requested work.",
    "",
    "## Test evidence",
    tests,
    "",
    "## Warnings",
    warnings,
    "",
    "## Safety",
    "- Created on a non-production branch by STAR WORK OS after validating the agent artifact.",
    "- Not merged to main.",
    "- No Production deployment, Production DB migration, secret change, or destructive action is authorized by this PR.",
    "- Human approval is required before protected actions.",
  ].join("\n");
  return { branch, title, body };
}

export const CODEX_CONNECTOR_BOT_LOGIN = "chatgpt-codex-connector[bot]";
export const CODEX_RECONCILE_MAX_BODY_BYTES = 8 * 1024;
export const CODEX_RESULT_SUMMARY_MAX_CHARS = 4000;

const GITHUB_PR_URL_PATTERN = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/(\d+)/gi;

export function parseGithubIssueExternalJobId(value) {
  if (typeof value !== "string") return null;
  const match = /^github-issue:(\d+)$/.exec(value);
  if (!match) return null;
  const issueNumber = Number(match[1]);
  return Number.isSafeInteger(issueNumber) && issueNumber > 0 ? issueNumber : null;
}

export function findFinalCodexComment(comments) {
  if (!Array.isArray(comments)) return null;
  const matches = comments.filter((comment) =>
    comment?.user?.login === CODEX_CONNECTOR_BOT_LOGIN &&
    typeof comment?.body === "string" &&
    comment.body.includes("[View task") &&
    comment.body.includes("https://chatgpt.com/s/")
  );
  return matches.at(-1) ?? null;
}

export function extractRepositoryPullRequest(body, repository) {
  if (typeof body !== "string" || typeof repository !== "string") return null;
  const expected = repository.toLowerCase();
  for (const match of body.matchAll(GITHUB_PR_URL_PATTERN)) {
    const matchedRepository = `${match[1]}/${match[2]}`;
    const number = Number(match[3]);
    if (matchedRepository.toLowerCase() === expected && Number.isSafeInteger(number) && number > 0) {
      return { number, url: `https://github.com/${matchedRepository}/pull/${number}` };
    }
  }
  return null;
}

export function summarizeCodexResult(body) {
  if (typeof body !== "string") return "";
  const withoutTaskLink = body
    .replace(/\s*\[View task[^\]]*\]\(https:\/\/chatgpt\.com\/s\/[^)]+\)\s*/gi, "\n")
    .trim();
  return withoutTaskLink.slice(0, CODEX_RESULT_SUMMARY_MAX_CHARS);
}

export function validateReconcileRequest(value) {
  if (!value || typeof value !== "object") return "INVALID_RECONCILE_REQUEST";
  const jobId = value.jobId;
  if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    return "INVALID_RECONCILE_JOB_ID";
  }
  return null;
}

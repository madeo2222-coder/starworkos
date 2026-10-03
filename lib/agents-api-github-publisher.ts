import {
  agentsResultBranchName,
  buildAgentsPullRequestMetadata,
  buildGitTreeElements,
} from "@/lib/agents-api-github-publish";

const GITHUB_API_BASE = "https://api.github.com";
const TIMEOUT_MS = 15_000;

function headers(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2026-03-10",
    "user-agent": "star-work-os-agents-publisher",
  };
}

async function request(repoApi: string, path: string, token: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${repoApi}${path}`, {
      ...init,
      headers: { ...headers(token), ...(init.headers ?? {}) },
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function json(response: Response) {
  try { return await response.json(); } catch { return null; }
}

async function existingPr(repoApi: string, owner: string, branch: string, base: string, token: string) {
  const response = await request(
    repoApi,
    `/pulls?state=open&head=${encodeURIComponent(owner + ":" + branch)}&base=${encodeURIComponent(base)}&per_page=10`,
    token,
  );
  if (!response.ok) return null;
  const pulls = await json(response);
  if (!Array.isArray(pulls)) return null;
  return pulls.find((pr) =>
    pr?.state === "open"
    && pr?.head?.ref === branch
    && pr?.base?.ref === base
    && typeof pr?.head?.sha === "string"
    && typeof pr?.html_url === "string"
    && Number.isSafeInteger(pr?.number)
  ) ?? null;
}

export async function publishAgentsResultToGithub({
  repository,
  baseBranch,
  jobId,
  taskTitle,
  result,
  token,
}: {
  repository: string;
  baseBranch: string;
  jobId: string;
  taskTitle: string;
  result: { summary: string; tests: string[]; warnings: string[]; files: Array<{ path: string; operation: string; content: string }> };
  token: string;
}) {
  const parts = repository.split("/");
  const branch = agentsResultBranchName(jobId);
  const metadata = buildAgentsPullRequestMetadata(jobId, taskTitle, result);
  const treeElements = buildGitTreeElements(result.files);
  if (parts.length !== 2 || !branch || !metadata || !treeElements) return { ok: false, error: "AGENTS_PUBLICATION_INPUT_INVALID" };
  const [owner, repo] = parts;
  const repoApi = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const found = await existingPr(repoApi, owner, branch, baseBranch, token);
  if (found) {
    return { ok: true, branch, commitSha: found.head.sha, pullRequestNumber: found.number, pullRequestUrl: found.html_url };
  }

  const branchResponse = await request(repoApi, `/git/ref/heads/${encodeURIComponent(branch)}`, token);
  let commitSha: string | null = null;

  if (branchResponse.ok) {
    const branchRef = await json(branchResponse);
    commitSha = typeof branchRef?.object?.sha === "string" ? branchRef.object.sha : null;
    if (!commitSha) return { ok: false, error: "AGENTS_EXISTING_BRANCH_INVALID" };
    const commitResponse = await request(repoApi, `/git/commits/${commitSha}`, token);
    if (!commitResponse.ok) return { ok: false, error: "AGENTS_EXISTING_COMMIT_LOOKUP_FAILED" };
    const commit = await json(commitResponse);
    if (commit?.message !== `agents: apply job ${jobId}`) return { ok: false, error: "AGENTS_EXISTING_BRANCH_IDENTITY_MISMATCH" };
  } else if (branchResponse.status === 404) {
    const baseRefResponse = await request(repoApi, `/git/ref/heads/${encodeURIComponent(baseBranch)}`, token);
    if (!baseRefResponse.ok) return { ok: false, error: "AGENTS_BASE_REF_LOOKUP_FAILED" };
    const baseRef = await json(baseRefResponse);
    const baseCommitSha = baseRef?.object?.sha;
    if (typeof baseCommitSha !== "string") return { ok: false, error: "AGENTS_BASE_REF_INVALID" };

    const baseCommitResponse = await request(repoApi, `/git/commits/${baseCommitSha}`, token);
    if (!baseCommitResponse.ok) return { ok: false, error: "AGENTS_BASE_COMMIT_LOOKUP_FAILED" };
    const baseCommit = await json(baseCommitResponse);
    const baseTreeSha = baseCommit?.tree?.sha;
    if (typeof baseTreeSha !== "string") return { ok: false, error: "AGENTS_BASE_TREE_INVALID" };

    const treeResponse = await request(repoApi, "/git/trees", token, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeElements }),
    });
    if (!treeResponse.ok) return { ok: false, error: "AGENTS_GIT_TREE_CREATE_FAILED" };
    const tree = await json(treeResponse);
    if (typeof tree?.sha !== "string") return { ok: false, error: "AGENTS_GIT_TREE_INVALID" };

    const commitResponse = await request(repoApi, "/git/commits", token, {
      method: "POST",
      body: JSON.stringify({ message: `agents: apply job ${jobId}`, tree: tree.sha, parents: [baseCommitSha] }),
    });
    if (!commitResponse.ok) return { ok: false, error: "AGENTS_GIT_COMMIT_CREATE_FAILED" };
    const commit = await json(commitResponse);
    if (typeof commit?.sha !== "string") return { ok: false, error: "AGENTS_GIT_COMMIT_INVALID" };
    commitSha = commit.sha;

    const refResponse = await request(repoApi, "/git/refs", token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha }),
    });
    if (!refResponse.ok) return { ok: false, error: "AGENTS_GIT_BRANCH_CREATE_FAILED" };
  } else {
    return { ok: false, error: "AGENTS_BRANCH_LOOKUP_FAILED" };
  }

  const pullResponse = await request(repoApi, "/pulls", token, {
    method: "POST",
    body: JSON.stringify({ title: metadata.title, body: metadata.body, head: branch, base: baseBranch, draft: false }),
  });
  if (!pullResponse.ok) return { ok: false, error: "AGENTS_PULL_REQUEST_CREATE_FAILED" };
  const pull = await json(pullResponse);
  if (
    !Number.isSafeInteger(pull?.number)
    || typeof pull?.html_url !== "string"
    || pull?.head?.ref !== branch
    || pull?.base?.ref !== baseBranch
    || pull?.head?.sha !== commitSha
  ) return { ok: false, error: "AGENTS_PULL_REQUEST_IDENTITY_MISMATCH" };

  return { ok: true, branch, commitSha, pullRequestNumber: pull.number, pullRequestUrl: pull.html_url };
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  agentsResultBranchName,
  buildAgentsPullRequestMetadata,
  buildGitTreeElements,
} from "../lib/agents-api-github-publish.js";

const jobId = "11111111-1111-4111-8111-111111111111";

test("derives one non-production branch from the external job id", () => {
  assert.equal(agentsResultBranchName(jobId), "agents/job-" + jobId);
  assert.equal(agentsResultBranchName("not-a-uuid"), null);
});

test("converts only validated result files into Git tree changes", () => {
  assert.deepEqual(buildGitTreeElements([
    { path: "docs/a.md", operation: "upsert", content: "hello" },
    { path: "docs/old.md", operation: "delete", content: "" },
  ]), [
    { path: "docs/a.md", mode: "100644", type: "blob", content: "hello" },
    { path: "docs/old.md", mode: "100644", type: "blob", sha: null },
  ]);
});

test("PR metadata stops at human approval and carries test evidence", () => {
  const metadata = buildAgentsPullRequestMetadata(jobId, "Safe task", {
    summary: "Implemented safely.",
    tests: ["npm test", "npm run lint"],
    warnings: [],
  });
  assert.equal(metadata.branch, "agents/job-" + jobId);
  assert.match(metadata.title, /Safe task/);
  assert.match(metadata.body, /npm test/);
  assert.match(metadata.body, /Human approval is required/);
  assert.match(metadata.body, /Not merged to main/);
});

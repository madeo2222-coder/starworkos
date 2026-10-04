export const AGENTS_API_RESULT_PATH: string;
export const AGENTS_API_MAX_RESULT_BYTES: number;
export const AGENTS_API_MAX_ARCHIVE_BYTES: number;

export function agentsApiConfig(env?: NodeJS.ProcessEnv):
  | { ok: true; apiKey: string; model: string }
  | { ok: false; error: string };

export function validateAgentsApiPayload(payload: unknown): string | null;
export function buildAgentsApiInstructions(payload: {
  job: { id: string; repository: string; baseBranch: string };
  task: { title: string; content?: string | null };
}): string;
export function buildAgentsApiSessionRequest(
  payload: {
    job: { id: string; repository: string; baseBranch: string };
    task: { title: string; content?: string | null };
  },
  repositoryArchiveBase64: string,
  model?: string,
): unknown;

export function parseAgentsSessionExternalJobId(value: unknown): string | null;
export function selectCompletedRootTurn(turns: unknown): { id: string; status: string; subagent_id?: string | null } | null;
export function selectAgentsResultArtifact(
  artifacts: unknown,
  turnId: string,
): { id: string; turn_id: string; path: string; size_bytes: number } | null;
export function validateAgentsResult(value: unknown):
  | {
      summary: string;
      tests: string[];
      warnings: string[];
      files: Array<{ path: string; operation: "upsert" | "delete"; content: string }>;
    }
  | null;

export type ExternalAgentJobStatus = "QUEUED" | "RUNNING" | "WAITING_HUMAN_APPROVAL" | "SUCCEEDED" | "FAILED" | "CANCELLED";
export const JOB_STATUSES: readonly ExternalAgentJobStatus[];
export const SUPPORTED_PROVIDERS: readonly string[];
export const SUPPORTED_CAPABILITIES: readonly string[];
export const TERMINAL_STATUSES: readonly ExternalAgentJobStatus[];
export const HUMAN_APPROVAL_ACTIONS: readonly string[];
export function isValidTransition(from: ExternalAgentJobStatus, to: ExternalAgentJobStatus): boolean;
export function validateCreateInput(value: unknown): string | null;
export function validateResultInput(value: unknown): string | null;

export interface AgentProviderAdapter {
  dispatch(job: Record<string, unknown>): Promise<{ externalJobId: string }>;
  getStatus(job: Record<string, unknown>): Promise<ExternalAgentJobStatus>;
  cancel(job: Record<string, unknown>): Promise<void>;
}

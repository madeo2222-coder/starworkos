export type WorkflowAiResult = {
  work_note: string;
  deliverable: string;
};

export const WORKFLOW_AI_REQUEST_MAX_BODY_BYTES: number;
export const WORKFLOW_AI_TIMEOUT_MS: number;
export const WORKFLOW_AI_MAX_OUTPUT_TOKENS: number;
export const WORKFLOW_AI_MAX_PROMPT_CHARS: number;
export const WORKFLOW_AI_MAX_RESPONSE_CHARS: number;
export const WORKFLOW_AI_MAX_AUDIT_ERROR_CHARS: number;
export const WORKFLOW_AI_RESULT_FIELD_LIMITS: Readonly<{
  work_note: number;
  deliverable: number;
}>;

export function isValidWorkflowIdentifier(value: unknown): value is string;

export function validateWorkflowAiRequest(value: unknown): string | null;

export function getWorkflowAiAuditError(error: unknown): string;

export type WorkflowAiPromptInput = {
  employee?: {
    name?: string | null;
    role?: string | null;
    description?: string | null;
  } | null;
  workflow?: {
    title?: string | null;
    description?: string | null;
    priority?: string | null;
  } | null;
  step: {
    stepOrder: number;
    name?: string | null;
  };
  ceoInstruction?: string | null;
  previousStep?: string | null;
};

export function isRequirementsStep(
  step: WorkflowAiPromptInput["step"],
): boolean;

export function parseWorkflowAiResult(text: string): WorkflowAiResult;

export function buildWorkflowAiPrompt(
  input: WorkflowAiPromptInput,
): string;

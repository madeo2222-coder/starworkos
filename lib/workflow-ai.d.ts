export type WorkflowAiResult = {
  work_note: string;
  deliverable: string;
};

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

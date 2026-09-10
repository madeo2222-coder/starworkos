export type WorkflowCreationInput = {
  title: string;
  description: string;
  ceoInstruction: string;
  priority: string;
  projectId: string | null;
  taskId?: string;
};

export const WORKFLOW_CREATION_LIMITS: Readonly<{
  title: number;
  description: number;
  ceoInstruction: number;
}>;

export function isValidUuid(value: unknown): value is string;

export function getWorkflowCreationValidationError(
  value: unknown,
): string | null;

export function getWorkflowCreationRpcErrorMessage(
  message: unknown,
): string;

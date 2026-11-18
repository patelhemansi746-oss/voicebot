/**
 * Progress Event Types
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 3)
 */

export interface ProgressEvent {
  workflowId: string;
  executionId: string;
  stepId: string;
  stepIndex: number;
  totalSteps: number;
  percentage: number; // 0 to 100
  status: 'running' | 'completed' | 'paused' | 'failed' | 'resumed';
  currentStepName: string;
  message: string;
  timestamp: number;
}

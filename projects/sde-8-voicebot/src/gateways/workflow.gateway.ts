import { v4 as uuidv4 } from 'uuid';
import {
  ToolExecutionRequest,
  ToolExecutionResult,
  ModuleHealth
} from '../types/gateway.types';
import { AppError } from '../middleware/error.middleware';
import { env } from '../config/env';

export class WorkflowGateway {
  private status: 'UP' | 'DOWN' | 'DEGRADED' = 'UP';

  /**
   * Execute a controlled tool action through the Human-in-the-Loop safety gate
   */
  public async executeTool(
    request: ToolExecutionRequest,
    _tracking?: { sessionId?: string; requestId?: string; correlationId?: string }
  ): Promise<ToolExecutionResult> {
    const executionId = uuidv4();
    const start = Date.now();

    const riskLevel = request.riskLevel || 'A_INFORMATIONAL';

    // 1. Safety Gate Evaluation
    if (riskLevel === 'C_SENSITIVE' || riskLevel === 'D_DESTRUCTIVE') {
      if (!request.humanApproved) {
        throw new AppError(
          `Action '${request.toolName}' is classified as ${riskLevel} and requires explicit user authorization`,
          403,
          'APPROVAL_REQUIRED',
          {
            toolName: request.toolName,
            riskLevel,
            requiredApproval: true
          },
          false,
          `Confirmation needed: '${request.toolName}' requires your approval before running.`
        );
      }
    }

    const approvedBy =
      riskLevel === 'C_SENSITIVE' || riskLevel === 'D_DESTRUCTIVE'
        ? ('HUMAN' as const)
        : ('AUTO' as const);

    // 2. Mock Tool Execution
    let data: unknown;

    switch (request.toolName) {
      case 'calculator': {
        const expr = (request.parameters?.expression as string) || '2 + 2';
        // Safe evaluation for basic math expression
        let calculated = 0;
        try {
          // Remove any non-math characters
          const sanitizedExpr = expr.replace(/[^0-9\+\-\*\/\(\)\.\s]/g, '');
          // eslint-disable-next-line no-eval
          calculated = Function(`'use strict'; return (${sanitizedExpr})`)();
        } catch {
          calculated = 250; // default mock fallback
        }
        data = { expression: expr, result: calculated };
        break;
      }

      case 'file_search': {
        const pattern = (request.parameters?.pattern as string) || '*.ts';
        data = {
          pattern,
          matches: [
            { path: 'src/app.ts', size: 1420 },
            { path: 'src/server.ts', size: 890 },
            { path: 'docs/project_report.pdf', size: 1048576 }
          ]
        };
        break;
      }

      case 'file_reader': {
        const path = (request.parameters?.path as string) || 'README.md';
        data = {
          path,
          content: 'SDE-8 Voicebot: Backend & Sessions implementation with full module gateways.'
        };
        break;
      }

      case 'file_writer': {
        const path = (request.parameters?.path as string) || 'output.txt';
        data = {
          path,
          bytesWritten: 128,
          status: 'success'
        };
        break;
      }

      default: {
        data = {
          tool: request.toolName,
          status: 'executed',
          parameters: request.parameters
        };
      }
    }

    const durationMs = Date.now() - start;

    return {
      executionId,
      toolName: request.toolName,
      success: true,
      data,
      durationMs,
      approvedBy,
      timestamp: new Date().toISOString()
    };
  }

  public getHealth(): ModuleHealth {
    return {
      module: 'workflow',
      status: this.status,
      mode: env.MOCK_MODE ? 'mock' : 'live',
      latencyMs: 15,
      message: 'Workflow orchestration and mock tool executor operational'
    };
  }

  public setStatus(newStatus: 'UP' | 'DOWN' | 'DEGRADED'): void {
    this.status = newStatus;
  }
}

export const workflowGateway = new WorkflowGateway();

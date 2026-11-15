import { sessionService } from './session.service';
import { audioGateway } from '../gateways/audio.gateway';
import { transcriptionGateway } from '../gateways/transcription.gateway';
import { reasoningGateway } from '../gateways/reasoning.gateway';
import { workflowGateway } from '../gateways/workflow.gateway';
import {
  SessionInteractionRequest,
  SessionInteractionResult,
  ToolExecutionResult
} from '../types/gateway.types';
import { SessionEventType, SessionStatus } from '../types/session.types';
import { AppError } from '../middleware/error.middleware';

export class InteractionService {
  /**
   * Routes a voice session turn end-to-end through:
   * Audio ➔ Transcription ➔ Reasoning ➔ Workflow ➔ Final Output
   */
  public async processTurn(
    sessionId: string,
    request: SessionInteractionRequest,
    tracking: { requestId: string; correlationId: string }
  ): Promise<SessionInteractionResult> {
    const start = Date.now();
    const session = sessionService.getSessionById(sessionId);

    if (!session) {
      throw new AppError(`Session with ID '${sessionId}' not found`, 404, 'SESSION_NOT_FOUND', undefined, false);
    }

    if (session.status === SessionStatus.COMPLETED || session.status === SessionStatus.FAILED || session.status === SessionStatus.EXPIRED) {
      throw new AppError(
        `Cannot interact with session '${sessionId}' in terminal status '${session.status}'`,
        409,
        'ILLEGAL_TRANSITION',
        undefined,
        false
      );
    }

    // Auto-start if session is in CREATED status
    if (session.status === SessionStatus.CREATED) {
      sessionService.startSession(sessionId);
    }

    const { requestId, correlationId } = tracking;

    // 1. Audio Ingestion Gateway
    const audioResult = await audioGateway.processAudio(request.audio, {
      sessionId,
      requestId,
      correlationId
    });

    sessionService.recordEvent(sessionId, SessionEventType.AUDIO_INGESTED, {
      audioId: audioResult.audioId,
      format: audioResult.format,
      durationMs: audioResult.durationMs,
      requestId,
      correlationId
    });

    // 2. Transcription Gateway (Speech-to-Text)
    const promptOverride = request.promptText || request.audio?.mockPrompt;
    const transcriptionResult = await transcriptionGateway.transcribeAudio(
      audioResult,
      promptOverride,
      { sessionId, requestId, correlationId }
    );

    sessionService.recordEvent(sessionId, SessionEventType.TRANSCRIPTION_COMPLETED, {
      transcriptId: transcriptionResult.transcriptId,
      text: transcriptionResult.text,
      confidence: transcriptionResult.confidence,
      requestId,
      correlationId
    });

    // 3. Reasoning Gateway (Multimodal Intent & Context Analysis)
    const reasoningResult = await reasoningGateway.reason(
      transcriptionResult,
      session.context,
      { sessionId, requestId, correlationId }
    );

    sessionService.recordEvent(sessionId, SessionEventType.REASONING_COMPLETED, {
      reasoningId: reasoningResult.reasoningId,
      intent: reasoningResult.intent,
      toolRequired: reasoningResult.toolRequired,
      requestId,
      correlationId
    });

    // 4. Workflow Gateway & Safety Gate (Human-in-the-Loop)
    let workflowResult: ToolExecutionResult | undefined = undefined;

    if (reasoningResult.toolRequired) {
      const toolReq = reasoningResult.toolRequired;

      if (toolReq.requiresApproval && !request.humanApproved) {
        // Record that human approval is required
        sessionService.recordEvent(sessionId, SessionEventType.TOOL_APPROVAL_REQUIRED, {
          toolName: toolReq.toolName,
          riskLevel: toolReq.riskLevel,
          parameters: toolReq.parameters,
          requestId,
          correlationId
        });

        throw new AppError(
          `Action '${toolReq.toolName}' is classified as ${toolReq.riskLevel} and requires explicit user confirmation`,
          403,
          'APPROVAL_REQUIRED',
          {
            toolName: toolReq.toolName,
            riskLevel: toolReq.riskLevel,
            parameters: toolReq.parameters,
            approvalRequired: true
          },
          false,
          `Confirmation needed: '${toolReq.toolName}' requires your approval before running.`
        );
      }

      // Execute tool
      sessionService.recordEvent(sessionId, SessionEventType.TOOL_EXECUTING, {
        toolName: toolReq.toolName,
        riskLevel: toolReq.riskLevel,
        requestId,
        correlationId
      });

      workflowResult = await workflowGateway.executeTool(
        {
          toolName: toolReq.toolName,
          parameters: toolReq.parameters,
          riskLevel: toolReq.riskLevel,
          humanApproved: request.humanApproved
        },
        { sessionId, requestId, correlationId }
      );

      sessionService.recordEvent(sessionId, SessionEventType.TOOL_COMPLETED, {
        executionId: workflowResult.executionId,
        toolName: workflowResult.toolName,
        success: workflowResult.success,
        approvedBy: workflowResult.approvedBy,
        durationMs: workflowResult.durationMs,
        requestId,
        correlationId
      });
    }

    // 5. Final Synthesis
    let finalResponse = reasoningResult.suggestedResponse;
    if (workflowResult?.success && workflowResult.data) {
      if (workflowResult.toolName === 'calculator') {
        const calcData = workflowResult.data as { expression: string; result: number };
        finalResponse = `Calculated: ${calcData.expression} = ${calcData.result}`;
      } else if (workflowResult.toolName === 'file_search') {
        const searchData = workflowResult.data as { matches: Array<{ path: string }> };
        finalResponse = `Found ${searchData.matches.length} matching file(s): ${searchData.matches.map((m) => m.path).join(', ')}`;
      } else if (workflowResult.toolName === 'file_writer') {
        finalResponse = 'File operation authorized and executed successfully.';
      }
    }

    const durationMs = Date.now() - start;

    sessionService.recordEvent(sessionId, SessionEventType.INTERACTION_COMPLETED, {
      durationMs,
      finalResponse,
      requestId,
      correlationId
    });

    return {
      sessionId,
      audioResult,
      transcriptionResult,
      reasoningResult,
      workflowResult,
      finalResponse,
      durationMs,
      correlationId,
      requestId,
      timestamp: new Date().toISOString()
    };
  }
}

export const interactionService = new InteractionService();

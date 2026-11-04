/**
 * Approval Manager
 * Manages human-in-the-loop approval lifecycle: PENDING, APPROVED, REJECTED, EXPIRED.
 * Enforces non-bypassable invariant: Rejected or expired actions NEVER execute.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 2)
 */

import { EventEmitter } from 'node:events';
import {
  ApprovalRequest,
  ApprovalDecision,
  ApprovalStatus,
  RiskLevel,
} from '../types/safety.js';

export class ApprovalExpiredError extends Error {
  constructor(public readonly approvalId: string, public readonly expiresAt: number) {
    super(
      `Approval request '${approvalId}' expired at ${new Date(
        expiresAt
      ).toISOString()}. Expired actions cannot be approved or executed.`
    );
    this.name = 'ApprovalExpiredError';
  }
}

export class ApprovalStateError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly currentStatus: ApprovalStatus,
    message: string
  ) {
    super(`Invalid approval state for '${approvalId}' (${currentStatus}): ${message}`);
    this.name = 'ApprovalStateError';
  }
}

export class ActionExecutionBlockedError extends Error {
  constructor(
    public readonly approvalId: string,
    public readonly status: ApprovalStatus | 'NOT_FOUND',
    public readonly reason: string
  ) {
    super(`Action execution blocked for approval '${approvalId}': ${reason}`);
    this.name = 'ActionExecutionBlockedError';
  }
}

export interface ApprovalManagerOptions {
  defaultTtlMs?: number;
  enforceDoubleConfirmation?: boolean;
}

export class ApprovalManager extends EventEmitter {
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private approvalHistory: Map<string, ApprovalRequest> = new Map();
  private defaultTtlMs: number;
  private enforceDoubleConfirmation: boolean;

  constructor(options?: ApprovalManagerOptions) {
    super();
    this.defaultTtlMs = options?.defaultTtlMs ?? 5 * 60 * 1000; // 5 minutes default
    this.enforceDoubleConfirmation = options?.enforceDoubleConfirmation ?? false;
  }

  public setEnforceDoubleConfirmation(enforce: boolean): void {
    this.enforceDoubleConfirmation = enforce;
  }

  public getDefaultTtlMs(): number {
    return this.defaultTtlMs;
  }

  public setDefaultTtlMs(ttlMs: number): void {
    this.defaultTtlMs = ttlMs;
  }

  /**
   * Create and register a new pending approval request
   */
  public createRequest(
    params: {
      workflowId: string;
      stepId: string;
      toolName: string;
      riskLevel: RiskLevel;
      description?: string;
      parameters: Record<string, unknown>;
      consequencesSummary?: string;
      ttlMs?: number;
      requiresDoubleConfirmation?: boolean;
    }
  ): ApprovalRequest {
    const ttl = params.ttlMs ?? this.defaultTtlMs;
    const now = Date.now();
    const approvalId = `appr_${params.workflowId}_${params.stepId}_${now}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const request: ApprovalRequest = {
      approvalId,
      workflowId: params.workflowId,
      stepId: params.stepId,
      toolName: params.toolName,
      riskLevel: params.riskLevel,
      description:
        params.description ||
        `Execution of tool '${params.toolName}' with parameters: ${JSON.stringify(
          params.parameters
        )}`,
      parameters: params.parameters,
      consequencesSummary:
        params.consequencesSummary ||
        this.generateConsequencesSummary(params.toolName, params.riskLevel, params.parameters),
      createdAt: now,
      ttlMs: ttl,
      expiresAt: now + ttl,
      status: ApprovalStatus.PENDING,
      requiresDoubleConfirmation:
        params.requiresDoubleConfirmation ??
        (params.riskLevel === RiskLevel.D_HIGH_RISK_DESTRUCTIVE),
      confirmationCount: 0,
    };

    this.pendingApprovals.set(approvalId, request);
    this.emit('approvalCreated', request);
    return request;
  }

  /**
   * Check if a request has expired and transition it if needed
   */
  public isExpired(approvalId: string): boolean {
    const request = this.getRequest(approvalId);
    if (!request) return false;

    if (request.status === ApprovalStatus.EXPIRED) {
      return true;
    }

    if (
      request.status === ApprovalStatus.PENDING &&
      request.expiresAt &&
      Date.now() > request.expiresAt
    ) {
      request.status = ApprovalStatus.EXPIRED;
      this.pendingApprovals.delete(approvalId);
      this.approvalHistory.set(approvalId, request);
      this.emit('approvalExpired', request);
      return true;
    }

    return false;
  }

  /**
   * Sweep and expire all pending approvals past their expiration timestamp
   */
  public checkAndExpireAll(): ApprovalRequest[] {
    const expired: ApprovalRequest[] = [];
    const now = Date.now();

    for (const [id, req] of Array.from(this.pendingApprovals.entries())) {
      if (req.expiresAt && now > req.expiresAt) {
        req.status = ApprovalStatus.EXPIRED;
        this.pendingApprovals.delete(id);
        this.approvalHistory.set(id, req);
        expired.push(req);
        this.emit('approvalExpired', req);
      }
    }

    return expired;
  }

  /**
   * Approve a pending request with expiry check and double confirmation support
   */
  public approve(
    approvalId: string,
    options?: {
      approvedBy?: 'USER' | 'AUTO_POLICY';
      reason?: string;
    }
  ): ApprovalDecision {
    // 1. Check expiration first
    if (this.isExpired(approvalId)) {
      const req = this.getRequest(approvalId)!;
      throw new ApprovalExpiredError(approvalId, req.expiresAt ?? 0);
    }

    const request = this.getRequest(approvalId);
    if (!request) {
      throw new Error(`Approval request '${approvalId}' not found`);
    }

    // 2. Cannot approve already rejected
    if (request.status === ApprovalStatus.REJECTED) {
      throw new ApprovalStateError(
        approvalId,
        request.status,
        `Cannot approve request: action was already REJECTED.`
      );
    }

    // If already approved, return decision
    if (request.status === ApprovalStatus.APPROVED && request.decision) {
      return request.decision;
    }

    // 3. Check double confirmation requirement (e.g. Risk Level D) if enforced
    if (this.enforceDoubleConfirmation && request.requiresDoubleConfirmation) {
      const count = (request.confirmationCount ?? 0) + 1;
      request.confirmationCount = count;

      if (count < 2) {
        this.emit('firstConfirmationReceived', {
          request,
          count,
          remaining: 1,
        });
        return {
          approvalId,
          workflowId: request.workflowId,
          approved: false, // Not yet fully approved
          decidedBy: options?.approvedBy ?? 'USER',
          decidedAt: Date.now(),
          reason: 'First confirmation received; awaiting second confirmation for high-risk action.',
        };
      }
    }

    // 4. Mark fully approved
    request.status = ApprovalStatus.APPROVED;
    const decision: ApprovalDecision = {
      approvalId,
      workflowId: request.workflowId,
      approved: true,
      decidedBy: options?.approvedBy ?? 'USER',
      decidedAt: Date.now(),
      reason: options?.reason ?? 'Approved by authorized user',
    };
    request.decision = decision;

    this.pendingApprovals.delete(approvalId);
    this.approvalHistory.set(approvalId, request);

    this.emit('approvalResolved', { request, decision });
    return decision;
  }

  /**
   * Reject an action so it can NEVER execute
   */
  public reject(
    approvalId: string,
    reason = 'Action rejected by user',
    rejectedBy: 'USER' | 'AUTO_POLICY' = 'USER'
  ): ApprovalDecision {
    // 1. Check expiration
    if (this.isExpired(approvalId)) {
      const req = this.getRequest(approvalId)!;
      throw new ApprovalExpiredError(approvalId, req.expiresAt ?? 0);
    }

    const request = this.getRequest(approvalId);
    if (!request) {
      throw new Error(`Approval request '${approvalId}' not found`);
    }

    request.status = ApprovalStatus.REJECTED;
    request.rejectionReason = reason;

    const decision: ApprovalDecision = {
      approvalId,
      workflowId: request.workflowId,
      approved: false,
      decidedBy: rejectedBy,
      decidedAt: Date.now(),
      reason,
    };
    request.decision = decision;

    this.pendingApprovals.delete(approvalId);
    this.approvalHistory.set(approvalId, request);

    this.emit('approvalResolved', { request, decision });
    this.emit('approvalRejected', { request, decision });
    return decision;
  }

  /**
   * Strictly assert that the action associated with this approval can execute.
   * Throws ActionExecutionBlockedError if REJECTED, EXPIRED, or PENDING.
   */
  public assertCanExecute(approvalId: string): void {
    const request = this.getRequest(approvalId);
    if (!request) {
      throw new ActionExecutionBlockedError(
        approvalId,
        'NOT_FOUND',
        `No approval request found for ID '${approvalId}'. Unapproved actions cannot execute.`
      );
    }

    if (this.isExpired(approvalId) || request.status === ApprovalStatus.EXPIRED) {
      throw new ActionExecutionBlockedError(
        approvalId,
        ApprovalStatus.EXPIRED,
        `Action approval has EXPIRED. Expired actions never execute.`
      );
    }

    if (request.status === ApprovalStatus.REJECTED) {
      throw new ActionExecutionBlockedError(
        approvalId,
        ApprovalStatus.REJECTED,
        `Action was REJECTED (${request.rejectionReason || 'User denied'}). Rejected actions never execute.`
      );
    }

    if (request.status === ApprovalStatus.PENDING) {
      throw new ActionExecutionBlockedError(
        approvalId,
        ApprovalStatus.PENDING,
        `Action approval is still PENDING. Unapproved actions never execute.`
      );
    }

    if (request.status !== ApprovalStatus.APPROVED) {
      throw new ActionExecutionBlockedError(
        approvalId,
        request.status ?? ApprovalStatus.PENDING,
        `Action status is '${request.status}'. Only APPROVED actions may execute.`
      );
    }
  }

  /**
   * Query if an action is safe to execute without throwing
   */
  public canExecute(approvalId: string): boolean {
    try {
      this.assertCanExecute(approvalId);
      return true;
    } catch {
      return false;
    }
  }

  public getRequest(approvalId: string): ApprovalRequest | undefined {
    return this.pendingApprovals.get(approvalId) ?? this.approvalHistory.get(approvalId);
  }

  public getStatus(approvalId: string): ApprovalStatus | 'NOT_FOUND' {
    if (this.isExpired(approvalId)) return ApprovalStatus.EXPIRED;
    const req = this.getRequest(approvalId);
    return req?.status ?? 'NOT_FOUND';
  }

  public getPendingApprovals(): ApprovalRequest[] {
    this.checkAndExpireAll();
    return Array.from(this.pendingApprovals.values());
  }

  public getHistory(): ApprovalRequest[] {
    return Array.from(this.approvalHistory.values());
  }

  public clear(): void {
    this.pendingApprovals.clear();
    this.approvalHistory.clear();
  }

  private generateConsequencesSummary(
    toolName: string,
    riskLevel: RiskLevel,
    params: Record<string, unknown>
  ): string {
    if (riskLevel === RiskLevel.D_HIGH_RISK_DESTRUCTIVE) {
      return `CRITICAL: Action '${toolName}' will permanently delete or modify persistent resources (Target: ${JSON.stringify(
        params
      )}). This operation cannot be undone.`;
    }
    if (riskLevel === RiskLevel.C_SENSITIVE) {
      return `WARNING: Action '${toolName}' alters system or user files/configuration. Explicit user confirmation is required.`;
    }
    return `Notice: Action '${toolName}' requires authorization under current policy.`;
  }
}

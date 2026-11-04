/**
 * Safety & Human-in-the-Loop Gate
 * Enforces risk policies, approval boundaries, allow-lists, and approval lifecycles per PRD Section 18
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 2)
 */

import { EventEmitter } from 'node:events';
import { RiskLevel, ApprovalRequest, ApprovalDecision, SafetyPolicy } from '../types/safety.js';
import { ApprovalManager } from './ApprovalManager.js';

export class SafetyPolicyViolationError extends Error {
  constructor(public readonly toolName: string, public readonly riskLevel: RiskLevel, message: string) {
    super(`Safety policy violation for '${toolName}' (${riskLevel}): ${message}`);
    this.name = 'SafetyPolicyViolationError';
  }
}

export class SafetyGate extends EventEmitter {
  private policy: SafetyPolicy;
  private approvalManager: ApprovalManager;
  private pendingApprovals: Map<string, ApprovalRequest> = new Map();
  private approvalHistory: Map<string, ApprovalDecision> = new Map();

  constructor(customPolicy?: Partial<SafetyPolicy>, approvalManager?: ApprovalManager) {
    super();
    this.policy = {
      autoApproveLevelA: true,
      autoApproveLevelB: true,
      autoApproveLevelC: false,
      autoApproveLevelD: false, // Invariant: Level D can never be auto-approved
      ...customPolicy,
    };
    // Force safety invariant
    this.policy.autoApproveLevelD = false;

    this.approvalManager =
      approvalManager ??
      new ApprovalManager({
        defaultTtlMs: this.policy.defaultApprovalTtlMs,
      });

    // Forward approval manager events
    this.approvalManager.on('approvalCreated', (req) => this.emit('approvalCreated', req));
    this.approvalManager.on('approvalResolved', (data) => this.emit('approvalResolved', data));
    this.approvalManager.on('approvalRejected', (data) => this.emit('approvalRejected', data));
    this.approvalManager.on('approvalExpired', (req) => this.emit('approvalExpired', req));
  }

  public getPolicy(): Readonly<SafetyPolicy> {
    return this.policy;
  }

  public getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }

  public updatePolicy(updates: Partial<SafetyPolicy>): void {
    this.policy = {
      ...this.policy,
      ...updates,
      autoApproveLevelD: false, // Invariant preserved
    };
    if (updates.defaultApprovalTtlMs) {
      this.approvalManager.setDefaultTtlMs(updates.defaultApprovalTtlMs);
    }
  }

  /**
   * Determine whether an action requires human approval
   */
  public evaluate(
    workflowId: string,
    stepId: string,
    toolName: string,
    riskLevel: RiskLevel,
    parameters: Record<string, unknown>,
    description = ''
  ): { requiresApproval: boolean; approvalRequest?: ApprovalRequest } {
    // Check if tool is explicitly blocked
    if (this.policy.blockedToolNames?.includes(toolName)) {
      throw new SafetyPolicyViolationError(
        toolName,
        riskLevel,
        `Tool '${toolName}' is blocked by system policy`
      );
    }

    // Check if tool name is restricted to allowed list
    if (
      this.policy.allowedToolNames &&
      this.policy.allowedToolNames.length > 0 &&
      !this.policy.allowedToolNames.includes(toolName)
    ) {
      throw new SafetyPolicyViolationError(
        toolName,
        riskLevel,
        `Tool '${toolName}' is not in the permitted whitelist`
      );
    }

    // Category A: Informational -> no approval required
    if (riskLevel === RiskLevel.A_INFORMATIONAL && this.policy.autoApproveLevelA) {
      return { requiresApproval: false };
    }

    // Category B: Low-Risk -> policy checked
    if (riskLevel === RiskLevel.B_LOW_RISK && this.policy.autoApproveLevelB) {
      return { requiresApproval: false };
    }

    // Category C: Sensitive -> requires confirmation unless explicitly permitted in dev policy
    if (riskLevel === RiskLevel.C_SENSITIVE && this.policy.autoApproveLevelC) {
      return { requiresApproval: false };
    }

    // Category D: High Risk / Destructive -> ALWAYS requires explicit approval
    const approvalRequest = this.approvalManager.createRequest({
      workflowId,
      stepId,
      toolName,
      riskLevel,
      description,
      parameters,
      ttlMs: this.policy.defaultApprovalTtlMs,
      requiresDoubleConfirmation: riskLevel === RiskLevel.D_HIGH_RISK_DESTRUCTIVE,
    });

    this.pendingApprovals.set(approvalRequest.approvalId, approvalRequest);
    this.emit('approvalRequired', approvalRequest);

    return {
      requiresApproval: true,
      approvalRequest,
    };
  }

  /**
   * Submit user or system approval decision
   */
  public submitDecision(decision: ApprovalDecision): void {
    const request = this.pendingApprovals.get(decision.approvalId);
    if (!request) {
      throw new Error(`Approval request '${decision.approvalId}' not found or already resolved`);
    }

    const stepId = request.stepId;

    if (decision.approved) {
      this.approvalManager.approve(decision.approvalId, {
        approvedBy: decision.decidedBy,
        reason: decision.reason,
      });
    } else {
      this.approvalManager.reject(decision.approvalId, decision.reason, decision.decidedBy);
    }

    this.pendingApprovals.delete(decision.approvalId);
    const key = this.getApprovalKey(decision.workflowId, stepId);
    this.approvalHistory.set(key, decision);
  }

  /**
   * Approve an approval request directly
   */
  public approve(approvalId: string, options?: { approvedBy?: 'USER' | 'AUTO_POLICY'; reason?: string }): ApprovalDecision {
    const decision = this.approvalManager.approve(approvalId, options);
    const req = this.approvalManager.getRequest(approvalId);
    if (req) {
      const key = this.getApprovalKey(req.workflowId, req.stepId);
      this.approvalHistory.set(key, decision);
      this.pendingApprovals.delete(approvalId);
    }
    return decision;
  }

  /**
   * Reject an approval request directly
   */
  public reject(approvalId: string, reason?: string, rejectedBy: 'USER' | 'AUTO_POLICY' = 'USER'): ApprovalDecision {
    const decision = this.approvalManager.reject(approvalId, reason, rejectedBy);
    const req = this.approvalManager.getRequest(approvalId);
    if (req) {
      const key = this.getApprovalKey(req.workflowId, req.stepId);
      this.approvalHistory.set(key, decision);
      this.pendingApprovals.delete(approvalId);
    }
    return decision;
  }

  /**
   * Check if an approval has expired
   */
  public isExpired(approvalId: string): boolean {
    return this.approvalManager.isExpired(approvalId);
  }

  /**
   * Assert that an action can execute; throws if rejected, expired, or pending
   */
  public assertCanExecute(approvalId: string): void {
    this.approvalManager.assertCanExecute(approvalId);
  }

  /**
   * Check if a specific step in a workflow has been approved
   */
  public isStepApproved(workflowId: string, stepId: string): boolean {
    const key = this.getApprovalKey(workflowId, stepId);
    const decision = this.approvalHistory.get(key);
    return decision ? decision.approved : false;
  }

  public getPendingApprovals(): ApprovalRequest[] {
    return this.approvalManager.getPendingApprovals();
  }

  public clearHistory(): void {
    this.pendingApprovals.clear();
    this.approvalHistory.clear();
    this.approvalManager.clear();
  }

  private getApprovalKey(workflowId: string, stepId: string): string {
    return `${workflowId}:${stepId}`;
  }
}

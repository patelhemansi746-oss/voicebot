import { describe, it, expect } from 'vitest';
import { SafetyGate, SafetyPolicyViolationError } from '../src/safety/SafetyGate.js';
import { RiskLevel } from '../src/types/safety.js';

describe('SafetyGate and Human-in-the-Loop Policies', () => {
  it('should auto-approve Level A (Informational) requests', () => {
    const gate = new SafetyGate();
    const result = gate.evaluate(
      'wf_1',
      'step_explain',
      'summarize_text',
      RiskLevel.A_INFORMATIONAL,
      { text: 'Sample' }
    );

    expect(result.requiresApproval).toBe(false);
    expect(result.approvalRequest).toBeUndefined();
  });

  it('should auto-approve Level B (Low-Risk) by default', () => {
    const gate = new SafetyGate();
    const result = gate.evaluate(
      'wf_1',
      'step_search',
      'file_search',
      RiskLevel.B_LOW_RISK,
      { pattern: '*.ts' }
    );

    expect(result.requiresApproval).toBe(false);
  });

  it('should require approval for Level C (Sensitive)', () => {
    const gate = new SafetyGate();
    const result = gate.evaluate(
      'wf_1',
      'step_modify',
      'file_modify',
      RiskLevel.C_SENSITIVE,
      { filePath: 'config.json', content: '{}' }
    );

    expect(result.requiresApproval).toBe(true);
    expect(result.approvalRequest).toBeDefined();
    expect(result.approvalRequest?.riskLevel).toBe(RiskLevel.C_SENSITIVE);
    expect(result.approvalRequest?.requiresDoubleConfirmation).toBe(false);
  });

  it('should strictly require approval for Level D (Destructive) and enforce invariant', () => {
    // Attempt to bypass Level D in constructor and updatePolicy
    const gate = new SafetyGate({ autoApproveLevelD: true as unknown as boolean });
    expect(gate.getPolicy().autoApproveLevelD).toBe(false);

    gate.updatePolicy({ autoApproveLevelD: true as unknown as boolean });
    expect(gate.getPolicy().autoApproveLevelD).toBe(false);

    const result = gate.evaluate(
      'wf_1',
      'step_del',
      'file_delete',
      RiskLevel.D_HIGH_RISK_DESTRUCTIVE,
      { filePath: 'important.db' }
    );

    expect(result.requiresApproval).toBe(true);
    expect(result.approvalRequest?.requiresDoubleConfirmation).toBe(true);
    expect(result.approvalRequest?.consequencesSummary).toContain('CRITICAL');
  });

  it('should enforce blocked tools policy and throw SafetyPolicyViolationError', () => {
    const gate = new SafetyGate({
      blockedToolNames: ['shell_exec', 'format_disk'],
    });

    expect(() =>
      gate.evaluate('wf_1', 's1', 'shell_exec', RiskLevel.D_HIGH_RISK_DESTRUCTIVE, {})
    ).toThrow(SafetyPolicyViolationError);
  });

  it('should enforce allowedToolNames whitelist when configured', () => {
    const gate = new SafetyGate({
      allowedToolNames: ['file_search', 'file_read'],
    });

    // Allowed tool passes
    const allowed = gate.evaluate('wf_1', 's1', 'file_search', RiskLevel.B_LOW_RISK, { pattern: '*' });
    expect(allowed.requiresApproval).toBe(false);

    // Unlisted tool throws violation
    expect(() =>
      gate.evaluate('wf_1', 's2', 'browser_search', RiskLevel.B_LOW_RISK, { query: 'test' })
    ).toThrow(SafetyPolicyViolationError);
  });

  it('should manage approval lifecycle: pending, submission, and verification', () => {
    const gate = new SafetyGate();
    const evalResult = gate.evaluate(
      'wf_100',
      'step_rm',
      'file_delete',
      RiskLevel.D_HIGH_RISK_DESTRUCTIVE,
      { filePath: 'temp.log' }
    );

    const req = evalResult.approvalRequest!;
    expect(gate.getPendingApprovals().length).toBe(1);
    expect(gate.isStepApproved('wf_100', 'step_rm')).toBe(false);

    // Submit approval
    gate.submitDecision({
      approvalId: req.approvalId,
      workflowId: req.workflowId,
      approved: true,
      decidedBy: 'USER',
      decidedAt: Date.now(),
    });

    expect(gate.getPendingApprovals().length).toBe(0);
    expect(gate.isStepApproved('wf_100', 'step_rm')).toBe(true);

    // Submitting again should error
    expect(() =>
      gate.submitDecision({
        approvalId: req.approvalId,
        workflowId: req.workflowId,
        approved: true,
        decidedBy: 'USER',
        decidedAt: Date.now(),
      })
    ).toThrow();
  });
});

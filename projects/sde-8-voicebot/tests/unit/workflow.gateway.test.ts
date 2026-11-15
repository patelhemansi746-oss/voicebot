import { WorkflowGateway } from '../../src/gateways/workflow.gateway';
import { AppError } from '../../src/middleware/error.middleware';

describe('WorkflowGateway Unit Tests', () => {
  let gateway: WorkflowGateway;

  beforeEach(() => {
    gateway = new WorkflowGateway();
  });

  it('should execute calculator tool with Category A auto-approval', async () => {
    const result = await gateway.executeTool({
      toolName: 'calculator',
      parameters: { expression: '(10 * 10) + 50' },
      riskLevel: 'A_INFORMATIONAL'
    });

    expect(result.success).toBe(true);
    expect(result.toolName).toBe('calculator');
    expect(result.approvedBy).toBe('AUTO');
    expect((result.data as any).result).toBe(150);
  });

  it('should execute file_search tool with Category B auto-approval', async () => {
    const result = await gateway.executeTool({
      toolName: 'file_search',
      parameters: { pattern: '*.ts' },
      riskLevel: 'B_LOW_RISK'
    });

    expect(result.success).toBe(true);
    expect((result.data as any).matches.length).toBeGreaterThan(0);
  });

  it('should REJECT sensitive tool (Category C) without human approval with 403 APPROVAL_REQUIRED', async () => {
    await expect(
      gateway.executeTool({
        toolName: 'file_writer',
        parameters: { path: './test.txt' },
        riskLevel: 'C_SENSITIVE',
        humanApproved: false
      })
    ).rejects.toThrow(AppError);

    try {
      await gateway.executeTool({
        toolName: 'file_writer',
        parameters: { path: './test.txt' },
        riskLevel: 'C_SENSITIVE',
        humanApproved: false
      });
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.errorCode).toBe('APPROVAL_REQUIRED');
    }
  });

  it('should ALLOW sensitive tool (Category C) when explicitly human approved', async () => {
    const result = await gateway.executeTool({
      toolName: 'file_writer',
      parameters: { path: './test.txt', content: 'test content' },
      riskLevel: 'C_SENSITIVE',
      humanApproved: true
    });

    expect(result.success).toBe(true);
    expect(result.approvedBy).toBe('HUMAN');
  });

  it('should execute file_reader tool with auto-approval', async () => {
    const result = await gateway.executeTool({
      toolName: 'file_reader',
      parameters: { path: 'README.md' }
    });

    expect(result.success).toBe(true);
    expect((result.data as any).content).toContain('SDE-8 Voicebot');
  });

  it('should execute fallback for unknown tool', async () => {
    const result = await gateway.executeTool({
      toolName: 'custom_mock_tool',
      parameters: { foo: 'bar' }
    });

    expect(result.success).toBe(true);
    expect((result.data as any).tool).toBe('custom_mock_tool');
  });

  it('should fallback gracefully when calculator expression has syntax error', async () => {
    const result = await gateway.executeTool({
      toolName: 'calculator',
      parameters: { expression: '+++---invalid' }
    });

    expect(result.success).toBe(true);
    expect((result.data as any).result).toBe(250);
  });

  it('should report module health and support setStatus', () => {
    const health = gateway.getHealth();
    expect(health.module).toBe('workflow');
    expect(health.status).toBe('UP');

    gateway.setStatus('DEGRADED');
    expect(gateway.getHealth().status).toBe('DEGRADED');
  });
});

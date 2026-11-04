/**
 * Built-in Standard Tool Specifications
 * Two harmless tools implementing the real specification
 */

import { ToolSpec } from '../types/tool.js';
import { RiskLevel } from '../types/safety.js';

export const BUILT_IN_TOOLS: Record<string, ToolSpec> = {
  calculator: {
    name: 'calculator',
    description: 'Evaluates basic mathematical and arithmetic expressions safely',
    purpose: 'Safe numeric calculation and mathematical analysis',
    riskLevel: RiskLevel.A_INFORMATIONAL,
    requiredScopes: ['math:calculate', 'tools:read'],
    isIdempotent: true,
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Arithmetic expression to compute', required: true },
      },
      required: ['expression'],
    },
    failureBehavior: 'RETRY',
  },

  summarize_text: {
    name: 'summarize_text',
    description: 'Generates concise, bulleted, or structured summary of given text or document content',
    purpose: 'Document and conversation summarization',
    riskLevel: RiskLevel.A_INFORMATIONAL,
    requiredScopes: ['text:summarize', 'tools:read'],
    isIdempotent: true,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Content text to summarize', required: true },
        maxPoints: { type: 'number', description: 'Maximum number of bullet points' },
        focus: { type: 'string', description: 'Specific focus area for summary' },
      },
      required: ['text'],
    },
    failureBehavior: 'RETRY',
  },
};


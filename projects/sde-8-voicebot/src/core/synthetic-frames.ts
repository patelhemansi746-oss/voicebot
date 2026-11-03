import { ContextItem } from '../schemas/context.schema';

export interface SyntheticFrameDefinition {
  frameId: string;
  name: string;
  description: string;
  application: string;
  windowTitle: string;
  filePath?: string;
  lineNumber?: number;
  ocrContent: string;
  suggestedQuery: string;
  expectedIntent: string;
  expectedRiskLevel: 'A' | 'B' | 'C' | 'D';
}

export const SYNTHETIC_FRAMES: Record<string, SyntheticFrameDefinition> = {
  DEV_VSCODE_ERROR: {
    frameId: 'synth-frame-dev-001',
    name: 'VS Code TypeError Stack Trace',
    description: 'Developer workspace showing TypeError in AuthService.validateSession',
    application: 'VS Code',
    windowTitle: 'auth.service.ts - voicebot - Visual Studio Code',
    filePath: 'projects/sde-8-voicebot/src/services/auth.service.ts',
    lineNumber: 42,
    ocrContent: `TypeError: Cannot read properties of undefined (reading 'token')
    at AuthService.validateSession (auth.service.ts:42:18)
    at handleRequest (server.ts:18:22)`,
    suggestedQuery: 'Why is this application showing this error and how do I fix it?',
    expectedIntent: 'EXPLAIN_ERROR',
    expectedRiskLevel: 'A'
  },
  RESEARCH_PDF_ATTENTION: {
    frameId: 'synth-frame-res-002',
    name: 'Acrobat Reader Vaswani Attention Paper',
    description: 'Research PDF viewer showing Multi-Head Attention equations',
    application: 'Acrobat PDF Reader',
    windowTitle: 'Vaswani_Attention_2017.pdf - Adobe Acrobat Reader',
    filePath: 'papers/Vaswani_Attention_2017.pdf',
    lineNumber: 132,
    ocrContent: `Section 3.2: Multi-Head Attention allows the model to jointly attend to information from different representation subspaces at different positions.
MultiHead(Q, K, V) = Concat(head_1, ..., head_h)W^O
where head_i = Attention(QW_i^Q, KW_i^K, VW_i^V)`,
    suggestedQuery: 'Explain the methodology shown on this page.',
    expectedIntent: 'EXPLAIN_DOCUMENT',
    expectedRiskLevel: 'A'
  },
  CONTROLLED_ACTION_FILES: {
    frameId: 'synth-frame-act-003',
    name: 'File Explorer File Relocation',
    description: 'File system browser with selected lecture documents targeted for relocation',
    application: 'File Explorer',
    windowTitle: 'Downloads',
    filePath: 'C:/Users/Student/Downloads',
    ocrContent: `files_selected: ['lecture_notes.pdf', 'dataset_q3.csv']
target_dir: 'projects/sde-8-voicebot/'`,
    suggestedQuery: 'Move these files into the project folder.',
    expectedIntent: 'CONTROLLED_ACTION',
    expectedRiskLevel: 'C'
  },
  PRIVACY_PII_LEAK: {
    frameId: 'synth-frame-sec-004',
    name: 'Environment Configuration with Exposed Credentials',
    description: 'VS Code file editor displaying exposed third-party API keys and passwords',
    application: 'VS Code',
    windowTitle: '.env.production - Visual Studio Code',
    filePath: '.env.production',
    ocrContent: `OPENAI_API_KEY=sk-abcdef1234567890abcdef1234567890
DATABASE_PASSWORD="SuperSecretAdminPass"
JWT_BEARER=Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`,
    suggestedQuery: 'What settings are configured in this file?',
    expectedIntent: 'GENERAL_QUERY',
    expectedRiskLevel: 'A'
  }
};

/**
 * Converts a SyntheticFrameDefinition into a validated ContextItem
 */
export function createSyntheticContextItem(frame: SyntheticFrameDefinition): ContextItem {
  return {
    id: frame.frameId,
    source: {
      application: frame.application,
      windowTitle: frame.windowTitle,
      filePath: frame.filePath,
      lineNumber: frame.lineNumber,
      capturedAt: new Date().toISOString(),
      isSynthetic: true
    },
    type: 'synthetic_frame',
    content: frame.ocrContent,
    confidence: 1.0,
    isSynthetic: true,
    metadata: {
      name: frame.name,
      description: frame.description,
      expectedIntent: frame.expectedIntent,
      expectedRiskLevel: frame.expectedRiskLevel
    }
  };
}

/**
 * Retrieves a synthetic frame definition by key or ID.
 */
export function getSyntheticFrameByKey(key: string): SyntheticFrameDefinition | undefined {
  if (SYNTHETIC_FRAMES[key]) {
    return SYNTHETIC_FRAMES[key];
  }
  return Object.values(SYNTHETIC_FRAMES).find(
    f => f.frameId === key || f.name.toLowerCase() === key.toLowerCase()
  );
}

/**
 * Lists all available synthetic frames with descriptions.
 */
export function listSyntheticFrames(): SyntheticFrameDefinition[] {
  return Object.values(SYNTHETIC_FRAMES);
}

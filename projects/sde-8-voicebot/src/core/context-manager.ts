import { AggregatedContext, ChatMessage, ScreenContext, ApplicationContext, UserInfo, ContextItem } from '../schemas/context.schema';
import { 
  SYNTHETIC_FRAMES, 
  SyntheticFrameDefinition, 
  createSyntheticContextItem, 
  getSyntheticFrameByKey, 
  listSyntheticFrames 
} from './synthetic-frames';

export class ContextManager {
  private sessions: Map<string, AggregatedContext> = new Map();
  private maxHistoryMessages: number;
  // PRD Section 19: Screen capture is strictly disabled (Week 1 allows synthetic frames only)
  private readonly captureEnabled: boolean = false;

  constructor(maxHistoryMessages: number = 10) {
    this.maxHistoryMessages = maxHistoryMessages;
  }

  /**
   * Returns current screen capture status. Always false (Synthetic frames only).
   */
  public isCaptureEnabled(): boolean {
    return false;
  }

  /**
   * Screen capture cannot be enabled; Week 1 allows synthetic frames only with no real screenshots.
   */
  public setCaptureEnabled(enabled: boolean): void {
    if (enabled) {
      throw new Error('Live screen capture is disabled. Week 1 allows synthetic frames only, with no real screenshots.');
    }
  }

  /**
   * Returns available pre-defined synthetic frames.
   */
  public getAvailableSyntheticFrames(): SyntheticFrameDefinition[] {
    return listSyntheticFrames();
  }

  /**
   * Loads a synthetic frame directly into a session context.
   */
  public loadSyntheticFrame(sessionId: string, frameKey: string, userQuery?: string): AggregatedContext {
    const frame = getSyntheticFrameByKey(frameKey);
    if (!frame) {
      throw new Error(`Synthetic frame '${frameKey}' not found. Available: ${Object.keys(SYNTHETIC_FRAMES).join(', ')}`);
    }

    const contextItem = createSyntheticContextItem(frame);
    const existing = this.sessions.get(sessionId);
    const history = existing ? existing.history : [];

    const aggregated: AggregatedContext = {
      sessionId,
      user: existing?.user || { userId: 'student-dev', role: 'developer', preferences: {} },
      application: {
        application: frame.application,
        windowTitle: frame.windowTitle,
        filePath: frame.filePath
      },
      screen: {
        rawOcrText: frame.ocrContent,
        capturedAt: new Date().toISOString(),
        sanitized: true,
        isSynthetic: true
      },
      contextItems: [contextItem],
      history: history.slice(-this.maxHistoryMessages),
      userQuery: userQuery || frame.suggestedQuery,
      createdAt: new Date().toISOString()
    };

    this.sessions.set(sessionId, aggregated);
    return aggregated;
  }

  /**
   * Sanitizes sensitive text (API keys, bearer tokens, passwords) to ensure privacy compliance.
   */
  public sanitize(text: string): string {
    if (!text) return '';
    return text
      .replace(/(sk-[a-zA-Z0-9_\-]{20,})/g, '[REDACTED_API_KEY]')
      .replace(/(Bearer\s+[a-zA-Z0-9_\-\.]{20,})/gi, 'Bearer [REDACTED_TOKEN]')
      .replace(/(password|passwd|secret|api_key)\s*[:=]\s*['"][^'"]+['"]/gi, '$1="[REDACTED]"');
  }

  /**
   * Registers or updates context for a given session.
   */
  public updateContext(
    sessionId: string,
    user: UserInfo,
    application: ApplicationContext,
    screen: ScreenContext,
    userQuery: string
  ): AggregatedContext {
    const existing = this.sessions.get(sessionId);
    const history = existing ? existing.history : [];

    // PRD Section 19: Live screen capture is disabled (Week 1 allows synthetic frames only, no real screenshots)
    if ((screen as any).isSynthetic === false) {
      throw new Error('Live screen capture is disabled. Week 1 allows synthetic frames only, with no real screenshots.');
    }

    const sanitizedScreenText = this.sanitize(screen.rawOcrText);

    const activeContextItem: ContextItem = {
      id: `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      source: {
        application: application.application,
        windowTitle: application.windowTitle || '',
        filePath: application.filePath,
        capturedAt: new Date().toISOString(),
        isSynthetic: true
      },
      type: 'screen_ocr',
      content: sanitizedScreenText,
      confidence: 1.0,
      isSynthetic: true,
      metadata: {}
    };

    const aggregated: AggregatedContext = {
      sessionId,
      user,
      application: {
        ...application,
        windowTitle: this.sanitize(application.windowTitle || '')
      },
      screen: {
        ...screen,
        rawOcrText: sanitizedScreenText,
        sanitized: true
      },
      contextItems: [activeContextItem],
      history: history.slice(-this.maxHistoryMessages),
      userQuery: this.sanitize(userQuery),
      createdAt: new Date().toISOString()
    };

    this.sessions.set(sessionId, aggregated);
    return aggregated;
  }

  /**
   * Appends a message to conversation history.
   */
  public appendMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string): void {
    const context = this.sessions.get(sessionId);
    if (!context) return;

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      role,
      content: this.sanitize(content),
      timestamp: new Date().toISOString()
    };

    context.history.push(newMessage);
    if (context.history.length > this.maxHistoryMessages) {
      context.history = context.history.slice(-this.maxHistoryMessages);
    }
  }

  /**
   * Retrieves active context for a session.
   */
  public getContext(sessionId: string): AggregatedContext | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Serializes the aggregated context into prompt template variables.
   */
  public serializeForPrompt(context: AggregatedContext): Record<string, string> {
    const historyString = context.history
      .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join('\n') || 'None';

    return {
      active_application: context.application.application,
      window_title: context.application.windowTitle || 'Untitled Window',
      screen_context: context.screen.rawOcrText || 'No screen data available',
      conversation_history: historyString,
      user_query: context.userQuery
    };
  }
}


import { RiskLevel } from '../schemas/reasoning.schema';

export interface PromptInjectionAnalysis {
  hasInjection: boolean;
  patternsDetected: string[];
  severity: 'CLEAN' | 'LOW' | 'MEDIUM' | 'HIGH';
  sanitizedText: string;
}

/**
 * PromptInjectionGuard (Week 3 - Days 19–20)
 * 
 * Enforces:
 * 1. Strict containment of untrusted user queries and screen OCR.
 * 2. Neutralization of XML delimiter breakout attempts (e.g. </untrusted_user_query>).
 * 3. Prevention of goal hijacking, role confusion, and safety rule overrides.
 * 4. Guarantee that instructions embedded in screen OCR are NEVER promoted to executable actions.
 */
export class PromptInjectionGuard {
  // Regex patterns commonly used in prompt injection attacks
  private static readonly INJECTION_PATTERNS: Array<{ name: string; pattern: RegExp; severity: 'LOW' | 'MEDIUM' | 'HIGH' }> = [
    {
      name: 'DELIMITER_BREAKOUT',
      pattern: /<\/?(?:untrusted_[a-zA-Z_]+|system|admin|prompt_instruction|root)>/gi,
      severity: 'HIGH'
    },
    {
      name: 'SYSTEM_OVERRIDE_DIRECTIVE',
      pattern: /(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+(?:instructions|rules|directions|guidelines)/gi,
      severity: 'HIGH'
    },
    {
      name: 'SAFETY_BYPASS_ATTEMPT',
      pattern: /(?:bypass|disable|override)\s+(?:safety|approval|security|permission|confirmation|gate)/gi,
      severity: 'HIGH'
    },
    {
      name: 'ROLE_HIJACKING',
      pattern: /(?:you\s+are\s+now|act\s+as|pretend\s+you\s+are)\s+(?:an?\s+unrestricted|admin|developer\s+mode|root|jailbroken)/gi,
      severity: 'HIGH'
    },
    {
      name: 'ADMIN_PRIVILEGE_ESCALATION',
      pattern: /(?:grant|enable|elevate)\s+(?:admin|root|superuser|unrestricted)\s+(?:access|privilege|mode)/gi,
      severity: 'HIGH'
    },
    {
      name: 'COMMAND_INJECTION_SCREEN',
      pattern: /(?:system\s+command|run\s+command|execute|shell):\s*(?:rm\s+-rf|del\s+|format\s+|drop\s+table)/gi,
      severity: 'MEDIUM'
    }
  ];

  /**
   * Analyzes text for prompt injection signatures and returns sanitized output.
   */
  public analyzeAndSanitize(text: string): PromptInjectionAnalysis {
    if (!text || text.trim().length === 0) {
      return {
        hasInjection: false,
        patternsDetected: [],
        severity: 'CLEAN',
        sanitizedText: ''
      };
    }

    const detectedPatterns: string[] = [];
    let highestSeverity: 'CLEAN' | 'LOW' | 'MEDIUM' | 'HIGH' = 'CLEAN';

    for (const check of PromptInjectionGuard.INJECTION_PATTERNS) {
      if (check.pattern.test(text)) {
        detectedPatterns.push(check.name);
        if (check.severity === 'HIGH' || highestSeverity === 'CLEAN') {
          highestSeverity = check.severity;
        }
      }
    }

    const sanitized = this.neutralize(text);

    return {
      hasInjection: detectedPatterns.length > 0,
      patternsDetected: detectedPatterns,
      severity: highestSeverity,
      sanitizedText: sanitized
    };
  }

  /**
   * Neutralizes harmful delimiters, escape sequences, and override directives.
   */
  public neutralize(text: string): string {
    if (!text) return '';

    return text
      // Neutralize XML delimiter breakouts
      .replace(/<\/(untrusted_[a-zA-Z_]+|system|admin)>/gi, '[SANITIZED_CLOSE_TAG]')
      .replace(/<(untrusted_[a-zA-Z_]+|system|admin)>/gi, '[SANITIZED_OPEN_TAG]')
      // Neutralize override keywords
      .replace(/ignore\s+all\s+previous\s+instructions/gi, '[SANITIZED_OVERRIDE_DIRECTIVE]')
      .replace(/disregard\s+prior\s+guidelines/gi, '[SANITIZED_OVERRIDE_DIRECTIVE]')
      .replace(/bypass\s+(safety|approval)\s+gate/gi, '[SANITIZED_BYPASS_ATTEMPT]')
      .replace(/you\s+are\s+now\s+an?\s+unrestricted/gi, '[SANITIZED_ROLE_HIJACK]');
  }

  /**
   * Acceptance Criteria: Instructions inside screen OCR are NEVER followed.
   * If screen OCR contains malicious directives like "delete all files", ensure it is
   * wrapped as passive, unexecutable text that cannot alter reasoning intent or bypass gates.
   */
  public sanitizeScreenContent(screenOcr: string): string {
    const analysis = this.analyzeAndSanitize(screenOcr);
    let safeOcr = analysis.sanitizedText;

    // Disarm any raw command invocations inside OCR text so they can never be executed
    safeOcr = safeOcr.replace(/(rm\s+-rf|del\s+\/s|drop\s+database)/gi, '[DISARMED_DANGEROUS_COMMAND]');

    return safeOcr;
  }

  /**
   * Verifies that safety classification cannot be bypassed by prompt injection.
   * If an action is dangerous (e.g. deletion), it must ALWAYS require Level D approval,
   * regardless of any text claiming "approval granted" inside the query or screen.
   */
  public verifySafetyInvariance(
    userQuery: string,
    actionType: string,
    baseRisk: RiskLevel
  ): { riskLevel: RiskLevel; requiresApproval: boolean } {
    const lowerQuery = userQuery.toLowerCase();
    const isDestructive = actionType.includes('delete') || lowerQuery.includes('rm -rf') || actionType.includes('format');

    if (isDestructive) {
      // Invariant: Destructive actions are ALWAYS Level D with mandatory approval
      return {
        riskLevel: 'D',
        requiresApproval: true
      };
    }

    const isSensitive = actionType.includes('move') || actionType.includes('rename') || lowerQuery.includes('mv ');
    if (isSensitive) {
      return {
        riskLevel: 'C',
        requiresApproval: true
      };
    }

    return {
      riskLevel: baseRisk,
      requiresApproval: baseRisk === 'C' || baseRisk === 'D'
    };
  }
}

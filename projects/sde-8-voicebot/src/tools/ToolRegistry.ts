/**
 * Tool Registry & Schema Validator
 * Validates tool signatures, parameter types, permission scopes, and allow-lists
 * Enforces harmless mock tools invariant: no unrestricted computer control and no external sending.
 */

import { ToolSpec } from '../types/tool.js';
import { BUILT_IN_TOOLS } from './built-in-tools.js';

export class ToolNotFoundError extends Error {
  constructor(public readonly toolName: string) {
    super(`Tool '${toolName}' is not registered in the tool registry`);
    this.name = 'ToolNotFoundError';
  }
}

export class ToolParameterValidationError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly errors: string[]
  ) {
    super(`Validation failed for tool '${toolName}': ${errors.join('; ')}`);
    this.name = 'ToolParameterValidationError';
  }
}

export class ToolNotAllowlistedError extends Error {
  constructor(public readonly toolName: string) {
    super(
      `Tool '${toolName}' is not in the allow-list. Only approved harmless tools are permitted.`
    );
    this.name = 'ToolNotAllowlistedError';
  }
}

export class PermissionScopeError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly missingScopes: string[],
    public readonly grantedScopes: string[] = []
  ) {
    super(
      `Permission scope violation for tool '${toolName}': missing required scope(s) [${missingScopes.join(
        ', '
      )}]. Granted scopes: [${grantedScopes.join(', ')}]`
    );
    this.name = 'PermissionScopeError';
  }
}

export class DangerousToolForbiddenError extends Error {
  constructor(public readonly toolName: string, public readonly reason: string) {
    super(`Dangerous tool '${toolName}' is strictly forbidden: ${reason}`);
    this.name = 'DangerousToolForbiddenError';
  }
}

export interface ToolRegistryOptions {
  loadBuiltIns?: boolean;
  initialAllowList?: string[];
  enforceAllowList?: boolean;
}

export class ToolRegistry {
  private tools: Map<string, ToolSpec> = new Map();
  private allowList: Set<string> = new Set();
  private enforceAllowList: boolean;

  /**
   * Blocked keywords for safety invariant:
   * No unrestricted computer control and no external sending.
   */
  private static readonly FORBIDDEN_TOOL_KEYWORDS = [
    'exec',
    'shell',
    'bash',
    'terminal',
    'cmd',
    'powershell',
    'mouse',
    'keyboard',
    'screen_control',
    'send_email',
    'send_external',
    'smtp',
    'http_post_external',
    'socket_raw',
    'rmdir_root',
  ];

  constructor(loadBuiltIns = true, options?: ToolRegistryOptions) {
    this.enforceAllowList = options?.enforceAllowList ?? true;

    // Initialize allow-list with harmless default tools
    const initialAllow = options?.initialAllowList ?? Object.keys(BUILT_IN_TOOLS);
    for (const name of initialAllow) {
      this.allowList.add(name);
    }

    if (loadBuiltIns || options?.loadBuiltIns) {
      this.loadBuiltIns();
    }
  }

  public loadBuiltIns(): void {
    for (const tool of Object.values(BUILT_IN_TOOLS)) {
      this.allowList.add(tool.name);
      this.register(tool, true);
    }
  }

  /**
   * Register a tool specification with safety checks
   */
  public register(tool: ToolSpec, isAllowlisted = true): void {
    // 1. Enforce safety invariant against unrestricted computer control and external sending
    this.assertHarmlessTool(tool.name);

    this.tools.set(tool.name, tool);

    if (isAllowlisted) {
      this.allowList.add(tool.name);
    }
  }

  /**
   * Check if tool violates safety invariant
   */
  public assertHarmlessTool(toolName: string): void {
    const lower = toolName.toLowerCase();
    for (const keyword of ToolRegistry.FORBIDDEN_TOOL_KEYWORDS) {
      if (lower.includes(keyword)) {
        throw new DangerousToolForbiddenError(
          toolName,
          `Tool violates safety invariant: unrestricted computer control and external sending are forbidden.`
        );
      }
    }
  }

  public allowTool(name: string): void {
    this.assertHarmlessTool(name);
    this.allowList.add(name);
  }

  public disallowTool(name: string): void {
    this.allowList.delete(name);
  }

  public isAllowlisted(name: string): boolean {
    return this.allowList.has(name);
  }

  public getAllowlist(): string[] {
    return Array.from(this.allowList);
  }

  public setAllowlist(names: string[]): void {
    for (const name of names) {
      this.assertHarmlessTool(name);
    }
    this.allowList = new Set(names);
  }

  public assertAllowlisted(toolName: string): void {
    if (this.enforceAllowList && !this.isAllowlisted(toolName)) {
      throw new ToolNotAllowlistedError(toolName);
    }
  }

  public get(name: string): ToolSpec | undefined {
    return this.tools.get(name);
  }

  public require(name: string): ToolSpec {
    const tool = this.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }
    return tool;
  }

  public has(name: string): boolean {
    return this.tools.has(name);
  }

  public list(): ToolSpec[] {
    return Array.from(this.tools.values());
  }

  /**
   * Validate runtime parameters against the tool's parameter schema
   */
  public validateParameters(toolName: string, params: Record<string, unknown>): void {
    const tool = this.require(toolName);
    const schema = tool.parameters;
    const errors: string[] = [];

    // Check required fields
    if (schema.required) {
      for (const requiredField of schema.required) {
        if (params[requiredField] === undefined || params[requiredField] === null) {
          errors.push(`Missing required parameter '${requiredField}'`);
        }
      }
    }

    // Check types and property constraints
    for (const [propName, propDef] of Object.entries(schema.properties)) {
      const val = params[propName];
      if (val === undefined || val === null) {
        if (propDef.required) {
          errors.push(`Missing required parameter '${propName}'`);
        }
        continue;
      }

      // Check type
      const actualType = Array.isArray(val) ? 'array' : typeof val;
      if (actualType !== propDef.type) {
        errors.push(
          `Parameter '${propName}' expected type '${propDef.type}', got '${actualType}'`
        );
      }

      // Check enum
      if (propDef.enum && !propDef.enum.includes(val as never)) {
        errors.push(
          `Parameter '${propName}' must be one of [${propDef.enum.join(', ')}], got '${String(val)}'`
        );
      }
    }

    if (errors.length > 0) {
      throw new ToolParameterValidationError(toolName, errors);
    }
  }

  /**
   * Validate that caller's granted scopes satisfy the tool's required scopes
   */
  public checkPermissionScopes(toolName: string, grantedScopes?: string[]): boolean {
    const tool = this.require(toolName);
    const required = tool.requiredScopes ?? (tool.requiredPermission ? [tool.requiredPermission] : []);

    if (required.length === 0) {
      return true;
    }

    if (grantedScopes === undefined) {
      return true; // Backward-compatible default when scopes not explicitly checked
    }

    const granted = grantedScopes;

    // Check for global wildcard
    if (granted.includes('*')) {
      return true;
    }

    const missingScopes: string[] = [];
    for (const reqScope of required) {
      const hasScope = granted.some((g) => {
        if (g === reqScope) return true;
        if (g.endsWith(':*')) {
          const prefix = g.slice(0, -2);
          return reqScope.startsWith(prefix + ':');
        }
        return false;
      });

      if (!hasScope) {
        missingScopes.push(reqScope);
      }
    }

    if (missingScopes.length > 0) {
      throw new PermissionScopeError(toolName, missingScopes, granted);
    }

    return true;
  }
}

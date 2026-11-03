/**
 * Plan Validator
 * Validates WorkflowPlan for missing dependencies, cycles, allow-listed tools, and valid schemas.
 * Academia AI Voice Co-Pilot - SDE-8 Agentic Workflow System (Week 2)
 */

import { WorkflowPlan, StepType } from '../types/workflow.js';
import {
  PlanValidationErrorDetail,
  PlanValidationResult,
  ValidationOptions,
} from '../types/validation.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';

export class PlanValidationError extends Error {
  public readonly errors: PlanValidationErrorDetail[];

  constructor(errors: PlanValidationErrorDetail[]) {
    const summary = errors.map((e) => `[${e.code}] ${e.message}`).join('; ');
    super(`Workflow plan validation failed with ${errors.length} error(s): ${summary}`);
    this.name = 'PlanValidationError';
    this.errors = errors;
  }
}

export class PlanValidator {
  private toolRegistry?: ToolRegistry;

  constructor(toolRegistry?: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  public setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry;
  }

  /**
   * Validate a WorkflowPlan against structural, dependency, cycle, and safety rules
   */
  public validate(
    plan: WorkflowPlan,
    options?: ValidationOptions
  ): PlanValidationResult {
    const errors: PlanValidationErrorDetail[] = [];
    const checkRegistry = options?.checkToolRegistry ?? !!this.toolRegistry;
    const checkAllow = options?.checkAllowList ?? true;

    // 1. Check for empty workflow
    if (!plan.steps || plan.steps.length === 0) {
      errors.push({
        code: 'EMPTY_WORKFLOW',
        message: 'Workflow plan contains no steps',
      });
      return { isValid: false, errors };
    }

    const stepMap = new Map<string, (typeof plan.steps)[0]>();
    const stepIds = new Set<string>();

    // 2. Check for duplicate step IDs
    for (const step of plan.steps) {
      if (stepIds.has(step.id)) {
        errors.push({
          code: 'DUPLICATE_STEP_ID',
          stepId: step.id,
          message: `Duplicate step ID found: '${step.id}'`,
        });
      } else {
        stepIds.add(step.id);
        stepMap.set(step.id, step);
      }
    }

    // 3. Check initial step existence
    if (!plan.initialStepId) {
      errors.push({
        code: 'MISSING_INITIAL_STEP',
        message: 'Workflow plan has no initialStepId specified',
      });
    } else if (!stepMap.has(plan.initialStepId)) {
      errors.push({
        code: 'MISSING_INITIAL_STEP',
        stepId: plan.initialStepId,
        message: `Initial step '${plan.initialStepId}' does not exist in workflow steps`,
      });
    }

    // 4. Check step dependencies and self-dependencies
    for (const step of plan.steps) {
      const deps = [...(step.dependencies ?? []), ...(step.dependsOn ?? [])];
      for (const depId of deps) {
        if (depId === step.id) {
          errors.push({
            code: 'DEPENDENCY_CYCLE_DETECTED',
            stepId: step.id,
            cycle: [step.id, step.id],
            message: `Step '${step.id}' cannot depend on itself (self-dependency cycle)`,
          });
          continue;
        }

        if (!stepMap.has(depId)) {
          errors.push({
            code: 'MISSING_STEP_DEPENDENCY',
            stepId: step.id,
            message: `Step '${step.id}' depends on missing step '${depId}'`,
            details: { stepId: step.id, missingDependency: depId },
          });
        }
      }
    }

    // 5. Check transitions
    if (plan.transitions) {
      for (const t of plan.transitions) {
        if (!stepMap.has(t.fromStepId)) {
          errors.push({
            code: 'MISSING_TRANSITION_STEP',
            stepId: t.fromStepId,
            message: `Transition references non-existent fromStepId '${t.fromStepId}'`,
          });
        }
        if (!stepMap.has(t.toStepId)) {
          errors.push({
            code: 'MISSING_TRANSITION_STEP',
            stepId: t.toStepId,
            message: `Transition references non-existent toStepId '${t.toStepId}'`,
          });
        }
      }
    }

    // 6. Detect cycles in step dependencies
    this.detectDependencyCycles(plan, errors);

    // 7. Detect cycles in transitions if requested
    if (options?.detectTransitionCycles) {
      this.detectTransitionCycles(plan, errors);
    }

    // 8. Validate tools with registry
    if (checkRegistry && this.toolRegistry) {
      this.validateTools(plan, this.toolRegistry, checkAllow, errors);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate plan or throw a descriptive PlanValidationError
   */
  public validateOrThrow(plan: WorkflowPlan, options?: ValidationOptions): void {
    const result = this.validate(plan, options);
    if (!result.isValid) {
      throw new PlanValidationError(result.errors);
    }
  }

  /**
   * Detect directed cycles in step dependencies using DFS 3-color graph traversal
   */
  private detectDependencyCycles(
    plan: WorkflowPlan,
    errors: PlanValidationErrorDetail[]
  ): void {
    const adj = new Map<string, string[]>();
    for (const step of plan.steps) {
      const deps = [...(step.dependencies ?? []), ...(step.dependsOn ?? [])];
      adj.set(step.id, deps);
    }

    const state = new Map<string, 'UNVISITED' | 'VISITING' | 'VISITED'>();
    for (const step of plan.steps) {
      state.set(step.id, 'UNVISITED');
    }

    const currentPath: string[] = [];

    const dfs = (node: string): boolean => {
      state.set(node, 'VISITING');
      currentPath.push(node);

      const neighbors = adj.get(node) ?? [];
      for (const neighbor of neighbors) {
        // Only explore valid steps that exist
        if (!adj.has(neighbor)) continue;

        if (state.get(neighbor) === 'VISITING') {
          // Cycle found!
          const cycleStartIndex = currentPath.indexOf(neighbor);
          const cyclePath = [...currentPath.slice(cycleStartIndex), neighbor];
          errors.push({
            code: 'DEPENDENCY_CYCLE_DETECTED',
            stepId: node,
            cycle: cyclePath,
            message: `Dependency cycle detected: ${cyclePath.join(' -> ')}`,
          });
          return true;
        }

        if (state.get(neighbor) === 'UNVISITED') {
          if (dfs(neighbor)) {
            return true;
          }
        }
      }

      currentPath.pop();
      state.set(node, 'VISITED');
      return false;
    };

    for (const step of plan.steps) {
      if (state.get(step.id) === 'UNVISITED') {
        dfs(step.id);
      }
    }
  }

  /**
   * Detect directed cycles in transition graph using DFS
   */
  private detectTransitionCycles(
    plan: WorkflowPlan,
    errors: PlanValidationErrorDetail[]
  ): void {
    if (!plan.transitions || plan.transitions.length === 0) return;

    const adj = new Map<string, string[]>();
    for (const step of plan.steps) {
      adj.set(step.id, []);
    }
    for (const t of plan.transitions) {
      if (adj.has(t.fromStepId) && adj.has(t.toStepId)) {
        adj.get(t.fromStepId)?.push(t.toStepId);
      }
    }

    const state = new Map<string, 'UNVISITED' | 'VISITING' | 'VISITED'>();
    for (const step of plan.steps) {
      state.set(step.id, 'UNVISITED');
    }

    const currentPath: string[] = [];

    const dfs = (node: string): boolean => {
      state.set(node, 'VISITING');
      currentPath.push(node);

      const neighbors = adj.get(node) ?? [];
      for (const neighbor of neighbors) {
        if (state.get(neighbor) === 'VISITING') {
          const cycleStartIndex = currentPath.indexOf(neighbor);
          const cyclePath = [...currentPath.slice(cycleStartIndex), neighbor];
          errors.push({
            code: 'TRANSITION_CYCLE_DETECTED',
            stepId: node,
            cycle: cyclePath,
            message: `Transition cycle detected: ${cyclePath.join(' -> ')}`,
          });
          return true;
        }

        if (state.get(neighbor) === 'UNVISITED') {
          if (dfs(neighbor)) {
            return true;
          }
        }
      }

      currentPath.pop();
      state.set(node, 'VISITED');
      return false;
    };

    for (const step of plan.steps) {
      if (state.get(step.id) === 'UNVISITED') {
        dfs(step.id);
      }
    }
  }

  /**
   * Validate tool references against ToolRegistry
   */
  private validateTools(
    plan: WorkflowPlan,
    registry: ToolRegistry,
    checkAllowList: boolean,
    errors: PlanValidationErrorDetail[]
  ): void {
    for (const step of plan.steps) {
      if (step.type === StepType.TOOL_EXECUTION) {
        if (!step.toolName) {
          errors.push({
            code: 'INVALID_PARAMETERS',
            stepId: step.id,
            message: `Step '${step.id}' is TOOL_EXECUTION but has no toolName specified`,
          });
          continue;
        }

        if (!registry.has(step.toolName)) {
          errors.push({
            code: 'UNREGISTERED_TOOL',
            stepId: step.id,
            message: `Tool '${step.toolName}' referenced in step '${step.id}' is not registered in ToolRegistry`,
          });
          continue;
        }

        if (checkAllowList && !registry.isAllowlisted(step.toolName)) {
          errors.push({
            code: 'TOOL_NOT_ALLOWLISTED',
            stepId: step.id,
            message: `Tool '${step.toolName}' referenced in step '${step.id}' is not in the allow-list`,
          });
          continue;
        }

        // Validate static parameters if present
        if (step.toolParameters && typeof step.toolParameters === 'object') {
          try {
            registry.validateParameters(step.toolName, step.toolParameters as Record<string, unknown>);
          } catch (paramErr) {
            errors.push({
              code: 'INVALID_PARAMETERS',
              stepId: step.id,
              message: paramErr instanceof Error ? paramErr.message : String(paramErr),
            });
          }
        }
      }
    }
  }
}

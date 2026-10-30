import { AsyncLocalStorage } from 'node:async_hooks';

/** Set while the workflow engine runs an action, so audit entries and emitted events are attributed to it. */
export interface AutomationScope {
  workflowId: string;
  executionId: string;
  /** Depth of the event that started this execution; events this run emits get depth + 1. */
  depth: number;
}

const storage = new AsyncLocalStorage<AutomationScope>();

export function runInAutomationScope<T>(scope: AutomationScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function currentAutomationScope(): AutomationScope | undefined {
  return storage.getStore();
}

/** Events beyond this depth are recorded but never start workflows, so automations cannot loop forever. */
export const MAX_AUTOMATION_DEPTH = 5;

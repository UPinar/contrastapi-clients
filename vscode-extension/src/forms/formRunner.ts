import * as vscode from "vscode";
import { McpTool } from "../mcp/client";
import { ToolSession } from "../session";
import { toolLabel } from "../views/toolTree";
import { applyStepAnswer, argumentSummary, optionalMenuItems, stepChoices, stepInputValue } from "./formPlan";
import { FormStep, FormSteps, buildFormSteps, parseStepValue } from "./schemaForm";

const CANCELLED = Symbol("cancelled");
const RUN_LABEL = "▶ Run";

/** FormRunOptions sets how runToolForm starts. */
export interface FormRunOptions {
  /** doneLabel names the "Add filter" menu's finish entry. The default is "▶ Run". */
  doneLabel?: string;
}

/**
 * Asks for one step's value.
 * current is the value the step holds now. The question starts from it, so a set filter can be changed.
 * The answer is undefined when the user clears the value, and CANCELLED on Escape.
 */
async function askStep(step: FormStep, title: string, current?: unknown): Promise<unknown> {
  const stepTitle = `${title}: ${step.field}`;
  if (step.kind === "enum" || step.kind === "boolean") {
    const picked = await vscode.window.showQuickPick(stepChoices(step, current), {
      title: stepTitle,
      placeHolder: step.prompt,
      ignoreFocusOut: true,
    });
    if (picked === undefined) {
      return CANCELLED;
    }
    if (picked.clear) {
      return undefined;
    }
    const parsed = parseStepValue(step, picked.label);
    return parsed.ok ? parsed.value : CANCELLED;
  }
  const raw = await vscode.window.showInputBox({
    title: stepTitle,
    prompt: step.prompt,
    value: stepInputValue(step, current),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const parsed = parseStepValue(step, value);
      return parsed.ok ? undefined : parsed.message;
    },
  });
  if (raw === undefined) {
    return CANCELLED;
  }
  const parsed = parseStepValue(step, raw);
  return parsed.ok ? parsed.value : CANCELLED;
}

interface FilterItem extends vscode.QuickPickItem {
  step?: FormStep;
}

/**
 * Shows the "Add filter" menu until the user picks the finish entry.
 * Every optional field stays listed with its value, so a set field can be changed or cleared.
 * The finish entry shows a summary of the arguments set so far.
 */
async function askOptionalSteps(
  form: FormSteps,
  args: Record<string, unknown>,
  title: string,
  doneLabel: string,
): Promise<boolean> {
  for (;;) {
    const summary = argumentSummary(args, form);
    const items: FilterItem[] = [
      summary === "" ? { label: doneLabel } : { label: doneLabel, description: summary },
      ...optionalMenuItems(form, args),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: `${title}: Add filter…`,
      placeHolder: "Run now, or pick an optional field to set, change or clear",
      matchOnDescription: true,
      matchOnDetail: true,
      ignoreFocusOut: true,
    });
    if (!picked) {
      return false;
    }
    if (!picked.step) {
      return true;
    }
    const value = await askStep(picked.step, title, args[picked.step.field]);
    if (value === CANCELLED) {
      return false;
    }
    applyStepAnswer(args, picked.step.field, value);
  }
}

/**
 * Asks for a tool's arguments without calling the tool.
 * Required steps come first, in schema order. Optional ones are offered in an "Add filter" menu, where a set one can be changed.
 * Escape at any point gives undefined, so the caller sends nothing and no credit is spent.
 * The answer includes the schema's fixed values.
 */
export async function askToolArguments(
  tool: McpTool,
  options: FormRunOptions = {},
): Promise<Record<string, unknown> | undefined> {
  const title = toolLabel(tool);
  const form = buildFormSteps(tool);
  const args: Record<string, unknown> = {};
  for (const step of form.required) {
    const value = await askStep(step, title);
    if (value === CANCELLED) {
      return undefined;
    }
    if (value !== undefined) {
      args[step.field] = value;
    }
  }
  if (form.optional.length > 0) {
    if (!(await askOptionalSteps(form, args, title, options.doneLabel ?? RUN_LABEL))) {
      return undefined;
    }
  }
  Object.assign(args, form.fixed);
  return args;
}

/**
 * Asks for a tool's arguments and runs it.
 * A destructive tool asks for a modal confirmation before the call.
 */
export async function runToolForm(session: ToolSession, tool: McpTool, options: FormRunOptions = {}): Promise<void> {
  const args = await askToolArguments(tool, options);
  if (!args) {
    return;
  }
  if (buildFormSteps(tool).confirm) {
    const answer = await vscode.window.showWarningMessage(`Run ${toolLabel(tool)}?`, { modal: true }, "Run");
    if (answer !== "Run") {
      return;
    }
  }
  await session.run(tool, args);
}

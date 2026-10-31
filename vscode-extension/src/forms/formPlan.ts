import { FormStep, FormSteps } from "./schemaForm";

/** JSON_TEXT_MAX is the most characters a JSON value shows in the "Add filter" menu. */
const JSON_TEXT_MAX = 40;
/** SUMMARY_TEXT_MAX is the most characters of the argument summary beside the finish entry. */
const SUMMARY_TEXT_MAX = 80;
/** SUMMARY_SEPARATOR goes between two arguments of the summary. */
const SUMMARY_SEPARATOR = " · ";
/** CLEAR_LABEL names the choice that removes an argument. */
const CLEAR_LABEL = "(clear)";
/** CURRENT_MARK marks the option a choice step holds now. */
const CURRENT_MARK = "(current)";

function hasArgument(values: Readonly<Record<string, unknown>>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, field);
}

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Returns the text that shows one argument's value in the menu and in the summary.
 * A list of strings is joined with commas.
 * A JSON value is cut to 40 characters, so a long array does not fill the line.
 */
export function argumentValueText(step: FormStep, value: unknown): string {
  if (step.kind === "json") {
    return shorten(JSON.stringify(value) ?? "", JSON_TEXT_MAX);
  }
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).join(", ");
  }
  return String(value);
}

/**
 * Returns the text an input box starts with when a set step is asked again.
 * The text is the whole value, not cut, so parseStepValue reads it back to the same value.
 * An unset step starts empty.
 */
export function stepInputValue(step: FormStep, value: unknown): string {
  if (value === undefined) {
    return "";
  }
  if (step.kind === "json") {
    return JSON.stringify(value);
  }
  return argumentValueText(step, value);
}

/** OptionalMenuItem is one optional step's entry in the "Add filter" menu. */
export interface OptionalMenuItem {
  label: string;
  /** description shows the value of a set step, such as "= CRITICAL ✓". It is undefined for an unset step. */
  description?: string;
  detail: string;
  step: FormStep;
}

/**
 * Returns the "Add filter" menu's entries, one for every optional step, in schema order.
 * A set step stays in the menu, so the user can change or clear its value.
 * A field set to a falsy value such as 0 or false counts as set.
 */
export function optionalMenuItems(form: FormSteps, values: Readonly<Record<string, unknown>>): OptionalMenuItem[] {
  return form.optional.map((step) => {
    const item: OptionalMenuItem = { label: step.field, detail: step.prompt, step };
    if (hasArgument(values, step.field)) {
      item.description = `= ${argumentValueText(step, values[step.field])} ✓`;
    }
    return item;
  });
}

/**
 * Returns the set arguments as one line, such as "severity=HIGH · limit=20".
 * The required steps come first, then the optional ones, each in schema order.
 * A key with no step in the form is left out.
 * The line is cut to 80 characters. It is empty when no argument is set.
 */
export function argumentSummary(values: Readonly<Record<string, unknown>>, form: FormSteps): string {
  const parts = [...form.required, ...form.optional]
    .filter((step) => hasArgument(values, step.field))
    .map((step) => `${step.field}=${argumentValueText(step, values[step.field])}`);
  return shorten(parts.join(SUMMARY_SEPARATOR), SUMMARY_TEXT_MAX);
}

/**
 * Stores one step's answer in the arguments.
 * An undefined answer removes the argument: an empty input box or "(clear)" gives one.
 */
export function applyStepAnswer(args: Record<string, unknown>, field: string, value: unknown): void {
  if (value === undefined) {
    delete args[field];
    return;
  }
  args[field] = value;
}

/** StepChoice is one entry of an enum or boolean step's pick list. clear is true on the entry that removes the argument. */
export interface StepChoice {
  label: string;
  description?: string;
  clear?: boolean;
}

/**
 * Returns the pick list of an enum or boolean step.
 * When the step holds a value, "(clear)" comes first and the current option is marked "(current)".
 */
export function stepChoices(step: FormStep, current: unknown): StepChoice[] {
  const options = step.kind === "boolean" ? ["true", "false"] : step.options ?? [];
  const choices: StepChoice[] = options.map((option) =>
    current !== undefined && option === String(current) ? { label: option, description: CURRENT_MARK } : { label: option },
  );
  return current === undefined ? choices : [{ label: CLEAR_LABEL, clear: true }, ...choices];
}

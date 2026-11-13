import { JsonSchemaProperty, McpTool } from "../mcp/client";

/** FormStepKind tells how one form step reads and checks the text the user types. */
export type FormStepKind = "text" | "integer" | "number" | "enum" | "boolean" | "stringList" | "json";

/**
 * FormStep is one input the form asks for.
 * buildFormSteps builds it from one property of a tool's inputSchema.
 */
export interface FormStep {
  field: string;
  prompt: string;
  required: boolean;
  kind: FormStepKind;
  options?: string[];
  /**
   * constValue is set for an optional property with a const value.
   * The step offers that one value as its only option, and parseStepValue returns it with its own type.
   */
  constValue?: unknown;
}

/** FormSteps holds the steps of one tool's form and the values it sends without asking. */
export interface FormSteps {
  required: FormStep[];
  optional: FormStep[];
  fixed: Record<string, unknown>;
  confirm: boolean;
}

/** StepValue is the answer of parseStepValue. It holds a value to send or a message to show. */
export type StepValue = { ok: true; value: unknown } | { ok: false; message: string };

function kindOf(prop: JsonSchemaProperty): FormStepKind {
  if (prop.enum !== undefined) {
    return "enum";
  }
  switch (prop.type) {
    case "integer":
      return "integer";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      if (prop.items?.type === "string") {
        return "stringList";
      }
      if (prop.items?.type === "object") {
        return "json";
      }
      return "text";
    default:
      return "text";
  }
}

/**
 * Returns the limits of a property as sentences, such as "Minimum 1. Maximum 100. Default 20.".
 * The server writes a property's range and default in the schema, not in its description.
 * The text is the one the SDKs put in their documentation (sdk/gen/gen_sdk.py, limit_text).
 * An enum has no length sentence, because its values already show the length.
 */
function limitText(prop: JsonSchemaProperty): string {
  const parts: string[] = [];
  if (typeof prop.minimum === "number") {
    parts.push(`Minimum ${prop.minimum}.`);
  }
  if (typeof prop.maximum === "number") {
    parts.push(`Maximum ${prop.maximum}.`);
  }
  if (typeof prop.maxLength === "number" && prop.enum === undefined) {
    parts.push(`At most ${prop.maxLength} characters.`);
  }
  const low = typeof prop.minItems === "number" ? prop.minItems : undefined;
  const high = typeof prop.maxItems === "number" ? prop.maxItems : undefined;
  if (low !== undefined && high !== undefined) {
    parts.push(`${low} to ${high} items.`);
  } else if (low !== undefined) {
    parts.push(`At least ${low} items.`);
  } else if (high !== undefined) {
    parts.push(`At most ${high} items.`);
  }
  if (typeof prop.default === "number" || typeof prop.default === "string" || typeof prop.default === "boolean") {
    parts.push(`Default ${String(prop.default)}.`);
  }
  return parts.join(" ");
}

/**
 * Returns the prompt of a step: the property's description, then its limits.
 * A property with neither is prompted by its name.
 */
function promptOf(field: string, prop: JsonSchemaProperty): string {
  const limits = limitText(prop);
  const description = prop.description ?? "";
  if (description === "") {
    return limits === "" ? field : limits;
  }
  if (limits === "") {
    return description;
  }
  return `${/[.!?]$/.test(description) ? description : `${description}.`} ${limits}`;
}

/**
 * Turns a tool's inputSchema into the steps of an input form.
 * Steps keep the schema's property order, so the form reads like the tool's documentation.
 * A required const property is not asked: its value goes into fixed.
 * An optional const property stays an opt-in step, because sending it always would change the call.
 * watchlist_edit's clear:true, for example, deletes every item.
 * confirm is true for a destructive tool, so the caller asks before it sends.
 */
export function buildFormSteps(tool: McpTool): FormSteps {
  const schema = tool.inputSchema;
  const requiredNames = new Set(schema.required ?? []);
  const form: FormSteps = {
    required: [],
    optional: [],
    fixed: {},
    confirm: tool.annotations?.destructiveHint === true,
  };
  for (const [field, prop] of Object.entries(schema.properties ?? {})) {
    const required = requiredNames.has(field);
    const hasConst = Object.prototype.hasOwnProperty.call(prop, "const");
    if (hasConst && required) {
      form.fixed[field] = prop.const;
      continue;
    }
    const step: FormStep = {
      field,
      prompt: promptOf(field, prop),
      required,
      kind: hasConst ? "enum" : kindOf(prop),
    };
    if (hasConst) {
      step.options = [String(prop.const)];
      step.constValue = prop.const;
    } else if (prop.enum !== undefined) {
      step.options = prop.enum.map((v) => String(v));
    }
    (required ? form.required : form.optional).push(step);
  }
  return form;
}

function refuse(message: string): StepValue {
  return { ok: false, message };
}

function parseJsonList(text: string): StepValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return refuse("Enter valid JSON: an array of objects.");
  }
  const isObjectList =
    Array.isArray(parsed) &&
    parsed.length > 0     &&
    parsed.every((v) => typeof v === "object" && v !== null && !Array.isArray(v));
  return isObjectList ? { ok: true, value: parsed } : refuse("Enter a JSON array of one or more objects.");
}

/**
 * Checks and converts the text the user typed for one step.
 * Empty input on an optional step gives value undefined, which means "leave the argument out".
 * Empty input on a required step is refused.
 * The checks catch typing mistakes before the call spends a credit.
 */
export function parseStepValue(step: FormStep, raw: string): StepValue {
  const text = raw.trim();
  if (step.kind === "stringList") {
    const parts = text.split(",").map((p) => p.trim()).filter((p) => p !== "");
    if (parts.length > 0) {
      return { ok: true, value: parts };
    }
    return step.required ? refuse(`${step.field} needs at least one value.`) : { ok: true, value: undefined };
  }
  if (text === "") {
    return step.required ? refuse(`${step.field} is required.`) : { ok: true, value: undefined };
  }
  switch (step.kind) {
    case "text":
      return { ok: true, value: text };
    case "integer": {
      const value = Number(text);
      if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(value)) {
        return refuse(`${step.field} must be a whole number.`);
      }
      return { ok: true, value };
    }
    case "number": {
      const value = Number(text);
      if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text) || !Number.isFinite(value)) {
        return refuse(`${step.field} must be a number.`);
      }
      return { ok: true, value };
    }
    case "enum": {
      const options = step.options ?? [];
      if (!options.includes(text)) {
        return refuse(`${step.field} must be one of: ${options.join(", ")}.`);
      }
      return { ok: true, value: step.constValue !== undefined ? step.constValue : text };
    }
    case "boolean":
      if (text === "true" || text === "false") {
        return { ok: true, value: text === "true" };
      }
      return refuse(`${step.field} must be true or false.`);
    case "json":
      return parseJsonList(text);
  }
  return refuse(`${step.field} has an unknown kind.`);
}

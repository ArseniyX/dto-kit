export interface ValidationArguments {
  /** The whole value of the property (the array/Set/Map itself when `each` is used). */
  value: unknown;
  constraints: unknown[];
  /** Name of the DTO class being validated. */
  targetName: string;
  /** The input object being validated. */
  object: Record<string, unknown>;
  property: string;
}

export interface ValidationOptions {
  /** String (supports $value, $property, $target, $constraint1..N tokens) or a function returning one. */
  message?: string | ((args: ValidationArguments) => string | undefined);
  /** Apply the rule to every element of an array/Set/Map (Map: its values). Non-iterables are checked as-is. */
  each?: boolean;
  groups?: string[];
  /** Run the rule even when validating a different group. */
  always?: boolean;
  /** Arbitrary data attached to the issue this rule produces. */
  context?: unknown;
  /** Skip this rule unless it returns true. Receives the input object and the (transformed) value. */
  validateIf?: (object: any, value: unknown) => boolean;
}

export interface GroupOptions {
  groups?: string[];
  always?: boolean;
  strictGroups?: boolean;
}

const OPTION_KEYS = new Set(["message", "each", "groups", "always", "context", "validateIf"]);
/** Distinguishes a trailing ValidationOptions from a validator.js options object. */
export const isValidationOptions = (x: unknown): x is ValidationOptions =>
  typeof x === "object" && x !== null && !Array.isArray(x) &&
  Object.keys(x).length > 0 && Object.keys(x).every((k) => OPTION_KEYS.has(k));

/** Same filtering rules as class-validator: `always` wins, then strictGroups, then group intersection. */
export function isActive(o: { groups?: string[]; always?: boolean }, g: GroupOptions): boolean {
  if (o.always !== undefined) {
    if (o.always) return true;
  } else if (!(o.groups && o.groups.length) && g.always) {
    return true;
  }
  const requested = g.groups;
  if (g.strictGroups && !(requested && requested.length) && o.groups && o.groups.length) return false;
  if (requested && requested.length > 0) return !!o.groups && o.groups.some((x) => requested.includes(x));
  return true;
}

const constraintToString = (c: unknown) => (Array.isArray(c) ? c.join(", ") : String(c));

export function formatMessage(
  custom: ValidationOptions["message"],
  fallback: string,
  args: ValidationArguments,
): string {
  let m = typeof custom === "function" ? custom(args) : custom;
  if (!m) m = fallback;
  args.constraints.forEach((c, i) => {
    m = m!.replace(new RegExp(`\\$constraint${i + 1}`, "g"), () => constraintToString(c));
  });
  const v = args.value;
  if (v !== undefined && v !== null && ["string", "boolean", "number"].includes(typeof v)) {
    m = m.replace(/\$value/g, () => String(v));
  }
  return m.replace(/\$property/g, () => args.property).replace(/\$target/g, () => args.targetName);
}

/** For custom decorators: builds a defaultMessage that adds the "each value in " prefix when `each` is set. */
export function buildMessage(
  impl: (eachPrefix: string, args: ValidationArguments) => string,
  validationOptions?: ValidationOptions,
): (args: ValidationArguments) => string {
  return (args) => impl(validationOptions?.each ? "each value in " : "", args);
}

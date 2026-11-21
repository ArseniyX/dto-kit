import { fieldMeta, type Ctor } from "./metadata.js";
import {
  ownOf, type ExcludeOptions, type ExposeOptions, type TransformFnParams, type TransformOptions, type TypeHelpOptions, type TypeOptions,
} from "./transform-meta.js";
import type { Rule } from "./metadata.js";
import { rule, type FieldDecorator } from "./internal.js";
import { member, toContext, type AnyCtx, type MemberDecorator } from "./context.js";
import { isValidationOptions, type ValidationOptions as VO } from "./validation.js";
export type { FieldDecorator, MemberDecorator };

// ---- type checks -------------------------------------------------------------------------------
export const IsString = (o?: VO) => rule("isString", (v) => (typeof v === "string" ? undefined : "must be a string"), o);
export const IsNumber = (o?: VO) =>
  rule("isNumber", (v) => (typeof v === "number" && Number.isFinite(v) ? undefined : "must be a number"), o);
export const IsInt = (o?: VO) => rule("isInt", (v) => (Number.isInteger(v) ? undefined : "must be an integer"), o);
export const IsBoolean = (o?: VO) => rule("isBoolean", (v) => (typeof v === "boolean" ? undefined : "must be a boolean"), o);
export const IsDate = (o?: VO) =>
  rule("isDate", (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? undefined : "must be a valid date"), o);
export const IsArray = (o?: VO) => rule("isArray", (v) => (Array.isArray(v) ? undefined : "must be an array"), o);
export const IsObject = (o?: VO) =>
  rule("isObject", (v) => (typeof v === "object" && v !== null && !Array.isArray(v) ? undefined : "must be an object"), o);
export const IsInstance = (cls: new (...a: any[]) => unknown, o?: VO) =>
  rule("isInstance", (v) => (v instanceof cls ? undefined : `must be an instance of ${cls.name}`), o, [cls]);

// ---- numbers -----------------------------------------------------------------------------------
export const Min = (min: number, o?: VO) =>
  rule("min", (v) => (typeof v === "number" && v >= min ? undefined : `must not be less than ${min}`), o, [min]);
export const Max = (max: number, o?: VO) =>
  rule("max", (v) => (typeof v === "number" && v <= max ? undefined : `must not be greater than ${max}`), o, [max]);
export const IsPositive = (o?: VO) => rule("isPositive", (v) => (typeof v === "number" && v > 0 ? undefined : "must be a positive number"), o);
export const IsNegative = (o?: VO) => rule("isNegative", (v) => (typeof v === "number" && v < 0 ? undefined : "must be a negative number"), o);
export const IsDivisibleBy = (n: number, o?: VO) =>
  rule("isDivisibleBy", (v) => (typeof v === "number" && v % n === 0 ? undefined : `must be divisible by ${n}`), o, [n]);

// ---- strings -----------------------------------------------------------------------------------
export const Length = (min: number, max?: number, o?: VO) =>
  rule(
    "length",
    (v) =>
      typeof v === "string" && v.length >= min && v.length <= (max ?? Infinity)
        ? undefined
        : `length must be between ${min} and ${max ?? "∞"}`,
    o,
    [min, max],
  );
export const MinLength = (n: number, o?: VO) =>
  rule("minLength", (v) => (typeof v === "string" && v.length >= n ? undefined : `must be at least ${n} characters`), o, [n]);
export const MaxLength = (n: number, o?: VO) =>
  rule("maxLength", (v) => (typeof v === "string" && v.length <= n ? undefined : `must be at most ${n} characters`), o, [n]);
/** `Matches(/re/, opts?)` or `Matches("re", "i", opts?)`. */
export function Matches(pattern: RegExp, o?: VO): FieldDecorator;
export function Matches(pattern: string, modifiers?: string, o?: VO): FieldDecorator;
export function Matches(pattern: RegExp | string, a?: string | VO, b?: VO): FieldDecorator {
  const modifiers = typeof a === "string" ? a : undefined;
  const o = typeof a === "object" ? a : b;
  const re = typeof pattern === "string" ? new RegExp(pattern, modifiers) : new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
  return rule("matches", (v) => (typeof v === "string" && re.test(v) ? undefined : `must match ${re} regular expression`), o, [pattern, modifiers]);
}
export const IsNotEmpty = (o?: VO) =>
  rule("isNotEmpty", (v) => (v !== "" && !(Array.isArray(v) && v.length === 0) ? undefined : "must not be empty"), o);

// ---- generic -----------------------------------------------------------------------------------
export const IsIn = (values: readonly unknown[], o?: VO) =>
  rule("isIn", (v) => (values.includes(v) ? undefined : `must be one of: ${values.join(", ")}`), o, [values]);
export const IsNotIn = (values: readonly unknown[], o?: VO) =>
  rule("isNotIn", (v) => (!values.includes(v) ? undefined : `must not be one of: ${values.join(", ")}`), o, [values]);
export const Equals = (x: unknown, o?: VO) => rule("equals", (v) => (v === x ? undefined : `must equal ${String(x)}`), o, [x]);
export const NotEquals = (x: unknown, o?: VO) => rule("notEquals", (v) => (v !== x ? undefined : `must not equal ${String(x)}`), o, [x]);
export const IsEnum = (e: object, o?: VO) => {
  const values = Object.entries(e).filter(([k]) => Number.isNaN(Number(k))).map(([, v]) => v); // skips numeric-enum reverse keys
  return rule("isEnum", (v) => (values.includes(v) ? undefined : `must be one of: ${values.join(", ")}`), o, [values]);
};
/** Escape hatch: your own rule. Return an error message, or undefined if valid. */
export const Custom = (fn: Rule, o?: VO, name = "custom") => rule(name, fn, o);

// ---- arrays ------------------------------------------------------------------------------------
export const ArrayMinSize = (n: number, o?: VO) =>
  rule("arrayMinSize", (v) => (Array.isArray(v) && v.length >= n ? undefined : `must contain at least ${n} items`), o, [n]);
export const ArrayMaxSize = (n: number, o?: VO) =>
  rule("arrayMaxSize", (v) => (Array.isArray(v) && v.length <= n ? undefined : `must contain at most ${n} items`), o, [n]);
export const ArrayNotEmpty = (o?: VO) =>
  rule("arrayNotEmpty", (v) => (Array.isArray(v) && v.length > 0 ? undefined : "must not be an empty array"), o);
export const ArrayContains = (values: readonly unknown[], o?: VO) =>
  rule("arrayContains", (v) => (Array.isArray(v) && values.every((x) => v.includes(x)) ? undefined : `must contain: ${values.join(", ")}`), o, [values]);
export const ArrayNotContains = (values: readonly unknown[], o?: VO) =>
  rule("arrayNotContains", (v) => (Array.isArray(v) && values.every((x) => !v.includes(x)) ? undefined : `must not contain: ${values.join(", ")}`), o, [values]);
/** Items must be unique; `identifier` picks the value compared (e.g. `(o) => o.id`). */
export const ArrayUnique = (identifier: (el: any) => unknown = (x) => x, o?: VO) =>
  rule("arrayUnique", (v) => (Array.isArray(v) && new Set(v.map(identifier)).size === v.length ? undefined : "must contain unique items"), o);

// ---- dates / objects ---------------------------------------------------------------------------
const time = (d: unknown) => (d instanceof Date ? d.getTime() : NaN);
export const MinDate = (d: Date | (() => Date), o?: VO) =>
  rule("minDate", (v) => (time(v) >= time(typeof d === "function" ? d() : d) ? undefined : "date is too early"), o, [d]);
export const MaxDate = (d: Date | (() => Date), o?: VO) =>
  rule("maxDate", (v) => (time(v) <= time(typeof d === "function" ? d() : d) ? undefined : "date is too late"), o, [d]);
/** Any own key counts; with `{ nullable: false }`, keys whose value is null/undefined don't. */
export const IsNotEmptyObject = (opts: { nullable?: boolean } = {}, o?: VO) =>
  rule(
    "isNotEmptyObject",
    (v) => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return "must be a non-empty object";
      const vals = Object.values(v);
      return (opts.nullable === false ? vals.some((x) => x !== null && x !== undefined) : vals.length > 0)
        ? undefined
        : "must be a non-empty object";
    },
    o,
    [opts],
  );
export const IsFirebasePushId = (o?: VO) =>
  rule("isFirebasePushId", (v) => (typeof v === "string" && /^[a-zA-Z0-9_-]{20}$/.test(v) ? undefined : "must be a Firebase Push Id"), o);

// ---- field modifiers ---------------------------------------------------------------------------
/** Field may be undefined/null; other rules are skipped in that case. */
export const Optional = (): FieldDecorator =>
  member((ctx) => {
    fieldMeta(ctx).optional = true;
  });
/** class-validator name for @Optional. */
export const IsOptional = Optional;
/** Whitelist the property without validating it (it may be missing). */
export const Allow = (): FieldDecorator =>
  member((ctx) => {
    fieldMeta(ctx).optional = true;
  });
/**
 * Marks the field as required (fields already are unless @Optional). Its options apply to the "missing" issue,
 * so `IsDefined({ message, context })` customises it.
 */
export const IsDefined = (o?: VO) =>
  rule("isDefined", (v) => (v !== undefined && v !== null ? undefined : "must not be null or undefined"), o);
const isField = (ctx: AnyCtx): ctx is ClassFieldDecoratorContext | ClassAccessorDecoratorContext =>
  ctx.kind === "field" || ctx.kind === "accessor";
/** Key under which class-transformer stores a decorator: the member name, or undefined for the class itself. */
const keyOf = (ctx: AnyCtx) => (ctx.kind === "class" ? undefined : String(ctx.name));

/**
 * Expose a property (or, on a class, switch the strategy to exposeAll). Options: `name`, `groups`, `since`/`until`,
 * `toClassOnly`/`toPlainOnly`. Works on getters and methods too, so computed values appear in instanceToPlain().
 */
export const Expose = (options: ExposeOptions = {}): MemberDecorator =>
  member((ctx) => {
    ownOf(ctx.metadata as DecoratorMetadataObject).expose.set(keyOf(ctx), options);
    // the validation engine reads input from the exposed name
    if (isField(ctx) && options.name && !options.toPlainOnly) fieldMeta(ctx).name = options.name;
  });
/** Exclude a property (or, on a class, switch the strategy to excludeAll). Options: `toClassOnly` / `toPlainOnly`. */
export const Exclude = (options: ExcludeOptions = {}): MemberDecorator =>
  member((ctx) => {
    ownOf(ctx.metadata as DecoratorMetadataObject).exclude.set(keyOf(ctx), options);
  });
/**
 * Declare a field's type. `@Type(() => Number | String | Boolean | Date)` coerces; `@Type(() => Dto)` builds nested
 * instances (plainToInstance) and validates them (parse). Without reflect-metadata dto-kit can't see a field is a
 * Map/Set: use `{ container: Map | Set }` or `@Type(() => Map | Set)`. Supports class-transformer's `discriminator`.
 * The thunk is lazy, so classes declared later in the file work.
 */
export const Type = (typeFunction?: (type: TypeHelpOptions) => unknown, options: TypeOptions = {}): MemberDecorator =>
  member((ctx) => {
    ownOf(ctx.metadata as DecoratorMetadataObject).types.set(String(ctx.name), { typeFunction, options });
    if (isField(ctx) && typeFunction) {
      const key = String(ctx.name);
      const f = fieldMeta(ctx);
      f.type = () => typeFunction({ newObject: undefined, object: {}, property: key });
      if (options.container) f.container = options.container;
    }
  });
/**
 * Nested DTO. Without `each`, accepts an object or arrays/Sets/Maps of them at any depth (like class-validator's
 * @ValidateNested). With `each: true`, the value must be an array of DTOs. `groups`/`always` take part in group
 * filtering like any rule. The class comes from `type`, or from each value's own constructor if omitted.
 */
export const Nested = (type?: () => Ctor, opts: VO = {}): FieldDecorator => (a, b, c) => {
  if (type) Type(type)(a, b, c);
  const f = fieldMeta(toContext(a, b, c));
  f.nestedOpts = opts;
  if (opts.each && type) f.each = true;
  else f.auto = true;
};
/** class-validator compatible: validates the field's value(s) using their own class. */
export const ValidateNested = (opts?: VO): FieldDecorator => Nested(undefined, opts);
/** The value is an array; rules, transforms and nesting apply to every element. */
export const Each = (): FieldDecorator =>
  member((ctx) => {
    fieldMeta(ctx).each = true;
  });
/**
 * Custom transform. Receives `{ value, key, obj, type, options }`. Runs before the rules in parse(), and during
 * plainToInstance / instanceToPlain / instanceToInstance (filter with `toClassOnly`, `toPlainOnly`, `groups`, `since`/`until`).
 * Several transforms on one property apply top decorator first.
 */
export const Transform = (fn: (params: TransformFnParams) => any, options: TransformOptions = {}): MemberDecorator =>
  member((ctx) => {
    const own = ownOf(ctx.metadata as DecoratorMetadataObject);
    const key = String(ctx.name);
    if (!own.transforms.has(key)) own.transforms.set(key, []);
    own.transforms.get(key)!.push({ fn, options });
    if (isField(ctx)) fieldMeta(ctx).transforms.push({ fn, options });
  });
/** Skip this field entirely (not even "required") unless `cond(inputObject)` is true. */
export const ValidateIf = (cond: (object: Record<string, unknown>) => boolean): FieldDecorator =>
  member((ctx) => {
    fieldMeta(ctx).condition = cond;
  });

export { isValidationOptions };

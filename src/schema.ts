import { hasFields, readFields, type Ctor, type FieldMeta, type RuleEntry } from "./metadata.js";
import { plainToInstance } from "./transformer.js";
import { formatMessage, isActive, type GroupOptions, type ValidationArguments } from "./validation.js";
import { TransformationType, type TransformMeta } from "./transform-meta.js";

export interface Issue {
  message: string;
  path: (string | number)[];
  /** Rule name, e.g. "minLength" ("isDefined" for missing required fields). */
  code?: string;
  /** The `context` passed in the failing rule's options. */
  context?: unknown;
}
export type ParseResult<T> = { success: true; value: T } | { success: false; issues: Issue[] };
export interface ParseOptions extends GroupOptions {
  /** Report unknown input keys as `whitelistValidation` issues instead of silently stripping them. */
  strict?: boolean;
  /** class-validator name for `strict`. */
  forbidNonWhitelisted?: boolean;
  /** class-validator: skip validation of properties that are null or undefined. */
  skipMissingProperties?: boolean;
  skipNullProperties?: boolean;
  skipUndefinedProperties?: boolean;
  /** Default true: unknown keys are dropped from the result. `false` copies them onto the result unvalidated. */
  whitelist?: boolean;
  /** Stop evaluating a field's rules after its first failure (default: report every failing rule). */
  stopAtFirstError?: boolean;
}

type Path = (string | number)[];
type Gen<T> = Generator<Promise<unknown>, T, unknown>;

// types that are never nested DTOs (Set/Map/Array are containers, handled by the transformer)
const PRIMITIVES: unknown[] = [Number, String, Boolean, Date, Set, Map, Array, Object];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isThenable = (x: unknown): x is Promise<unknown> => typeof (x as { then?: unknown } | null)?.then === "function";

function coerce(t: unknown, v: unknown): unknown {
  if (t === Number) return typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (t === String) return typeof v === "number" || typeof v === "boolean" ? String(v) : v;
  if (t === Boolean) return v === "true" || v === "1" || v === 1 ? true : v === "false" || v === "0" || v === 0 ? false : v;
  if (t === Date) return typeof v === "string" || typeof v === "number" ? new Date(v) : v;
  return v;
}

/** Await the values only if any is a promise, so purely synchronous validation stays synchronous. */
function* settle<T>(vals: (T | Promise<T>)[]): Gen<T[]> {
  return vals.some(isThenable) ? ((yield Promise.all(vals)) as T[]) : (vals as T[]);
}

function* evalRule(r: RuleEntry, f: FieldMeta, x: unknown, p: Path, input: Record<string, unknown>, cls: Ctor, issues: Issue[]): Gen<boolean> {
  const args: ValidationArguments = { value: x, constraints: r.constraints, targetName: cls.name, object: input, property: f.key };
  const each = r.opts.each && (Array.isArray(x) || x instanceof Set || x instanceof Map);
  let msg: string | undefined;
  if (each) {
    const items = x instanceof Map ? [...x.values()] : [...(x as Iterable<unknown>)];
    const results = yield* settle(items.map((it) => r.check(it, input, args)));
    const first = results.find((m) => m !== undefined);
    msg = first === undefined ? undefined : r.raw ? first : `each value in $property ${first}`;
  } else {
    [msg] = yield* settle([r.check(x, input, args)]);
    if (msg !== undefined && !r.raw) msg = `$property ${msg}`;
  }
  if (msg === undefined) return true;
  const issue: Issue = { message: formatMessage(r.opts.message, msg, args), path: p, code: r.name };
  if (r.opts.context !== undefined) issue.context = r.opts.context;
  issues.push(issue);
  return false;
}

/** class-validator style: object | array | Set | Map of DTOs, any depth. Path keys are indices / Map keys. */
function* buildNested(f: FieldMeta, v: unknown, p: Path, issues: Issue[], o: ParseOptions): Gen<unknown> {
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (let i = 0; i < v.length; i++) out.push(yield* buildNested(f, v[i], [...p, i], issues, o));
    return out;
  }
  if (v instanceof Set) {
    const out = new Set<unknown>();
    let i = 0;
    for (const x of v) out.add(yield* buildNested(f, x, [...p, i++], issues, o));
    return out;
  }
  if (v instanceof Map) {
    const out = new Map<unknown, unknown>();
    for (const [k, x] of v) out.set(k, yield* buildNested(f, x, [...p, String(k)], issues, o));
    return out;
  }
  if (isObj(v)) {
    const typed = f.type?.() as Ctor | undefined;
    const cls = typed ?? v.constructor;
    // an explicitly typed class with no validation rules (e.g. only @Expose/@Type) has nothing to validate: just build it
    if (typed && !hasFields(typed)) return plainToInstance(typed as any, v);
    if (!hasFields(cls)) {
      issues.push({ message: "nested value is not an instance of a class with validation decorators (pass a type: @Nested(() => Class))", path: p, code: "nestedValidation" });
      return undefined;
    }
    return yield* build(cls, v, p, issues, o);
  }
  issues.push({ message: `nested property ${f.key} must be either object or array`, path: p, code: "nestedValidation" });
  return undefined;
}

/** @Transform functions that apply when going plain -> class, filtered by groups like class-transformer. Top decorator first. */
function applyTransforms(f: FieldMeta, input: Record<string, unknown>, o: ParseOptions, value: unknown): unknown {
  const groups = o.groups ?? [];
  const list = f.transforms.filter((m: TransformMeta) => {
    if (m.options?.toPlainOnly && !m.options.toClassOnly) return false;
    const g = m.options?.groups;
    return groups.length ? !g || g.some((x) => groups.includes(x)) : !g || !g.length;
  });
  return list.slice().reverse().reduce(
    (acc, m) => m.fn({ value: acc, key: f.key, obj: input, type: TransformationType.PLAIN_TO_CLASS, options: { groups: o.groups } }),
    value,
  );
}

function* buildField(
  f: FieldMeta, raw: unknown, p: Path, input: Record<string, unknown>, issues: Issue[],
  o: ParseOptions, cls: Ctor, active: RuleEntry[],
): Gen<{ ok: boolean; value?: unknown }> {
  if (f.auto || f.container) {
    const before = issues.length;
    // @Type(..., { container }): plain JSON has no Maps/Sets, so rebuild them (once, for the field value) from an object / array
    let input: unknown = raw;
    if (f.container === Map && isObj(raw) && !(raw instanceof Map)) input = new Map(Object.entries(raw));
    else if (f.container === Set && Array.isArray(raw)) input = new Set(raw);
    const value = yield* buildNested(f, input, p, issues, o);
    return { ok: issues.length === before, value };
  }
  if (f.each && !Array.isArray(raw)) {
    issues.push({ message: `${f.key} must be an array`, path: p, code: "isArray" });
    return { ok: false };
  }
  const items: unknown[] = f.each ? (raw as unknown[]) : [raw];
  const out: unknown[] = [];
  let ok = true;
  for (let i = 0; i < items.length; i++) {
    const ip = f.each ? [...p, i] : p;
    const before = issues.length;
    const t = f.type?.();
    if (typeof t === "function" && !PRIMITIVES.includes(t)) {
      // a typed class with no validation rules is just built, not validated
      out.push(hasFields(t) ? yield* build(t as Ctor, items[i], ip, issues, o) : items[i] !== null && typeof items[i] === "object" ? plainToInstance(t as any, items[i]) : items[i]);
    } else {
      const x = applyTransforms(f, input, o, coerce(t, items[i]));
      for (const r of active) {
        if (r.opts.validateIf && !r.opts.validateIf(input, x)) continue;
        const pass = yield* evalRule(r, f, x, ip, input, cls, issues);
        if (!pass && o.stopAtFirstError) break;
      }
      out.push(x);
    }
    if (issues.length > before) ok = false;
  }
  return { ok, value: f.each ? out : out[0] };
}

function* build<T>(cls: Ctor<T>, input: unknown, path: Path, issues: Issue[], o: ParseOptions): Gen<T | undefined> {
  if (!isObj(input)) {
    issues.push({ message: "must be an object", path, code: "isObject" });
    return undefined;
  }
  const fields = readFields(cls);
  const out = new cls() as Record<string, unknown>;
  for (const f of fields.values()) {
    if (f.condition && !f.condition(input)) continue;
    const t = f.type?.();
    const isDto = !!f.auto || !!f.container || (typeof t === "function" && !PRIMITIVES.includes(t));
    // Group filtering: a field with rules takes part only if at least one of them is active.
    let active: RuleEntry[] = [];
    if (isDto) {
      if (!isActive(f.nestedOpts ?? {}, o)) continue;
    } else if (f.rules.length) {
      active = f.rules.filter((r) => isActive(r.opts, o));
      if (!active.length) continue;
    }
    const p = [...path, f.name];
    const v = input[f.name];
    if (v === undefined || v === null) {
      if (f.optional || o.skipMissingProperties || (v === null ? o.skipNullProperties : o.skipUndefinedProperties)) continue;
      // If every rule is switched off by validateIf, there is nothing to require.
      if (!isDto && f.rules.length && !active.some((r) => !r.opts.validateIf || r.opts.validateIf(input, v))) continue;
      const custom = f.rules.find((r) => r.name === "isDefined"); // IsDefined({ message, context }) customises this issue
      const issue: Issue = { message: `${f.key} is required`, path: p, code: "isDefined" };
      if (custom) {
        const args: ValidationArguments = { value: v, constraints: [], targetName: cls.name, object: input, property: f.key };
        issue.message = formatMessage(custom.opts.message, "$property must not be null or undefined", args);
        if (custom.opts.context !== undefined) issue.context = custom.opts.context;
      }
      issues.push(issue);
      continue;
    }
    const r = yield* buildField(f, v, p, input, issues, o, cls, active);
    if (r.ok) out[f.key] = r.value;
  }
  if (o.strict || o.forbidNonWhitelisted) {
    const known = new Set([...fields.values()].map((f) => f.name));
    for (const k of Object.keys(input)) {
      if (!known.has(k)) issues.push({ message: `property ${k} should not exist`, path: [...path, k], code: "whitelistValidation" });
    }
  } else if (o.whitelist === false) {
    const known = new Set([...fields.values()].map((f) => f.name));
    for (const k of Object.keys(input)) if (!known.has(k)) out[k] = input[k];
  }
  return out as T;
}

function drive<T>(gen: Gen<T>): T {
  const r = gen.next();
  if (!r.done) throw new Error("dto-kit: an async rule was used with parse(); use parseAsync() instead");
  return r.value;
}
async function driveAsync<T>(gen: Gen<T>, first?: IteratorResult<Promise<unknown>, T>): Promise<T> {
  let r = first ?? gen.next();
  while (!r.done) {
    try {
      r = gen.next(await r.value);
    } catch (e) {
      r = gen.throw(e);
    }
  }
  return r.value;
}

const result = <T>(value: T | undefined, issues: Issue[]): ParseResult<T> =>
  issues.length || value === undefined ? { success: false, issues } : { success: true, value };

export function parse<T>(cls: Ctor<T>, input: unknown, opts: ParseOptions = {}): ParseResult<T> {
  const issues: Issue[] = [];
  return result(drive(build(cls, input, [], issues, opts)), issues);
}

/**
 * Synchronous when every rule is synchronous, a Promise as soon as one async rule is met. This is what a Standard Schema
 * `validate()` is allowed to do, so purely synchronous DTOs stay synchronous.
 */
export function parseMaybeAsync<T>(cls: Ctor<T>, input: unknown, opts: ParseOptions = {}): ParseResult<T> | Promise<ParseResult<T>> {
  const issues: Issue[] = [];
  const gen = build(cls, input, [], issues, opts);
  const first = gen.next();
  if (first.done) return result(first.value, issues);
  return driveAsync(gen, first).then((v) => result(v, issues));
}

/** Like parse(), but supports async rules (e.g. a @Validate() constraint returning a Promise). */
export async function parseAsync<T>(cls: Ctor<T>, input: unknown, opts: ParseOptions = {}): Promise<ParseResult<T>> {
  const issues: Issue[] = [];
  return result(await driveAsync(build(cls, input, [], issues, opts)), issues);
}

/** Like parse(), but throws an Error (with .issues) on failure. */
export function parseOrThrow<T>(cls: Ctor<T>, input: unknown, opts?: ParseOptions): T {
  const r = parse(cls, input, opts);
  if (r.success) return r.value;
  throw Object.assign(new Error(`Validation failed: ${r.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`), { issues: r.issues });
}

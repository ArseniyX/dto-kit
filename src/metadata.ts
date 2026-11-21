// TS/esbuild read Symbol.metadata when a decorated class is defined, so this must run first.
(Symbol as { metadata?: symbol }).metadata ??= Symbol.for("Symbol.metadata");

import type { ValidationArguments, ValidationOptions } from "./validation.js";
import type { TransformMeta } from "./transform-meta.js";

/** Return the default error message, or undefined if valid. May be async (use parseAsync). */
export type Rule = (
  value: unknown,
  object: Record<string, unknown>,
  args: ValidationArguments,
) => string | undefined | Promise<string | undefined>;
export interface RuleEntry {
  /** Becomes Issue.code, e.g. "minLength". */
  name: string;
  check: Rule;
  constraints: unknown[];
  opts: ValidationOptions;
  /** The check's message is final (e.g. from buildMessage); don't add the "each value" prefix. */
  raw?: boolean;
}
export type Ctor<T = unknown> = new () => T;

export interface FieldMeta {
  key: string;
  /** Key used in input/output objects (set via @Expose). */
  name: string;
  optional: boolean;
  rules: RuleEntry[];
  /** Run before rules, top decorator first (like class-transformer). Applied per element when `each`. */
  transforms: TransformMeta[];
  /** When set, the field is skipped entirely (no required/rules) if this returns false. */
  condition?: (object: Record<string, unknown>) => boolean;
  /** Lazy: Number/String/Boolean/Date => coercion, any other class => nested DTO. */
  type?: () => unknown;
  /** groups/always for a nested DTO field (from @Nested/@ValidateNested). */
  nestedOpts?: ValidationOptions;
  /** Nested DTO, class-validator style: object, or arrays/Sets/Maps of them at any depth; class comes from `type` or the value. */
  auto?: boolean;
  /** `@Type(..., { container: Map | Set })`: the plain input (object / array) becomes a Map / Set of the type. */
  container?: Function;
  /** Value is an array; rules/transforms/nesting apply to each element. */
  each?: boolean;
}

const FIELDS = Symbol.for("dto-kit.fields");

type Store = Map<string, FieldMeta>;

/** Get (copy-on-write for inheritance) the field map stored on a decorator metadata object. */
export function fieldsOf(metadata: DecoratorMetadataObject): Store {
  if (!Object.prototype.hasOwnProperty.call(metadata, FIELDS)) {
    const inherited = (metadata as Record<symbol, Store | undefined>)[FIELDS];
    const copy: Store = new Map();
    inherited?.forEach((v, k) => copy.set(k, { ...v, rules: [...v.rules], transforms: [...v.transforms] }));
    (metadata as Record<symbol, Store>)[FIELDS] = copy;
  }
  return (metadata as Record<symbol, Store>)[FIELDS]!;
}

export function fieldMeta(ctx: { readonly name: string | symbol | undefined; readonly metadata: unknown }): FieldMeta {
  const key = String(ctx.name);
  const store = fieldsOf(ctx.metadata as DecoratorMetadataObject);
  let f = store.get(key);
  if (!f) {
    f = { key, name: key, optional: false, rules: [], transforms: [] };
    store.set(key, f);
  }
  return f;
}

export function readFields(cls: Ctor): Store {
  const md = (cls as unknown as Record<symbol, DecoratorMetadataObject | undefined>)[Symbol.metadata!];
  const store = md && (md as Record<symbol, Store | undefined>)[FIELDS];
  if (!store) throw new Error(`dto-kit: ${cls.name} has no decorated fields`);
  return store;
}

/** True if `cls` has dto-kit-decorated fields (used to validate nested instances without an explicit type). */
export function hasFields(cls: unknown): cls is Ctor {
  if (typeof cls !== "function") return false;
  const md = (cls as unknown as Record<symbol, DecoratorMetadataObject | undefined>)[Symbol.metadata!];
  return !!md && !!(md as Record<symbol, Store | undefined>)[FIELDS];
}

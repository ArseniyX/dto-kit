// Metadata for the class-transformer-compatible engine (Expose / Exclude / Type / Transform).
// Lives on the decorator metadata object of each class; lookups walk the class's ancestors like class-transformer does.
import "./metadata.js"; // installs Symbol.metadata

export enum TransformationType {
  PLAIN_TO_CLASS,
  CLASS_TO_PLAIN,
  CLASS_TO_CLASS,
}

export interface ExposeOptions {
  /** Only transform when `since <= options.version`. */
  since?: number;
  /** Only transform when `options.version < until`. */
  until?: number;
  /** Key used in the plain object. */
  name?: string;
  groups?: string[];
  toClassOnly?: boolean;
  toPlainOnly?: boolean;
}
export interface ExcludeOptions {
  toClassOnly?: boolean;
  toPlainOnly?: boolean;
}
export interface TypeHelpOptions {
  newObject: any;
  object: Record<string, any>;
  property: string | undefined;
}
export interface TypeOptions {
  discriminator?: { property: string; subTypes: { value: new (...a: any[]) => any; name: string }[] };
  /** Keep the discriminator property on the resulting object (default: removed). */
  keepDiscriminatorProperty?: boolean;
  /**
   * dto-kit has no reflect-metadata, so it can't see that a field is declared as `Map<K, V>` / `Set<V>`.
   * Say so here: `@Type(() => Weapon, { container: Map })`. (`@Type(() => Set)` / `@Type(() => Map)` also work.)
   */
  container?: MapConstructor | SetConstructor;
}
export interface TransformFnParams {
  value: any;
  key: string;
  obj: any;
  type: TransformationType;
  options: ClassTransformOptions;
}
export interface TransformOptions {
  since?: number;
  until?: number;
  groups?: string[];
  toClassOnly?: boolean;
  toPlainOnly?: boolean;
}
export interface TransformMeta {
  fn: (params: TransformFnParams) => any;
  options?: TransformOptions;
}
export interface TypeMeta {
  typeFunction?: (h: TypeHelpOptions) => any;
  options: TypeOptions;
}
export interface TargetMap {
  target: Function;
  properties: { [key: string]: Function };
}
export interface ClassTransformOptions {
  strategy?: "excludeAll" | "exposeAll";
  excludeExtraneousValues?: boolean;
  groups?: string[];
  version?: number;
  excludePrefixes?: string[];
  ignoreDecorators?: boolean;
  targetMaps?: TargetMap[];
  enableCircularCheck?: boolean;
  /** Not supported: needs reflect-metadata design types. Accepted and ignored. */
  enableImplicitConversion?: boolean;
  exposeDefaultValues?: boolean;
  exposeUnsetFields?: boolean;
}

interface Own {
  expose: Map<string | undefined, ExposeOptions>;
  exclude: Map<string | undefined, ExcludeOptions>;
  types: Map<string, TypeMeta>;
  transforms: Map<string, TransformMeta[]>;
}
const TKEY = Symbol.for("dto-kit.transform");

/** The class-transformer metadata of the class being decorated (created on first use). */
export function ownOf(metadata: DecoratorMetadataObject): Own {
  if (!Object.prototype.hasOwnProperty.call(metadata, TKEY)) {
    (metadata as Record<symbol, Own>)[TKEY] = { expose: new Map(), exclude: new Map(), types: new Map(), transforms: new Map() };
  }
  return (metadata as Record<symbol, Own>)[TKEY]!;
}

function ownFor(cls: Function): Own | undefined {
  if (typeof cls !== "function") return undefined; // targets can be undefined or a TypeMeta (discriminated arrays)
  if (!Object.prototype.hasOwnProperty.call(cls, Symbol.metadata!)) return undefined;
  const md = (cls as any)[Symbol.metadata!] as DecoratorMetadataObject | undefined;
  return md && Object.prototype.hasOwnProperty.call(md, TKEY) ? (md as Record<symbol, Own>)[TKEY] : undefined;
}

/** Nearest ancestor first, like class-transformer's getAncestors(). */
function ancestors(cls: Function | undefined): Function[] {
  if (!cls) return [];
  const out: Function[] = [];
  for (let b = Object.getPrototypeOf(cls); b && typeof b.prototype !== "undefined"; b = Object.getPrototypeOf(b)) out.push(b);
  return out;
}

function find<T>(cls: Function, pick: (o: Own) => T | undefined): T | undefined {
  const own = ownFor(cls);
  const mine = own && pick(own);
  if (mine) return mine;
  for (const a of ancestors(cls)) {
    const o = ownFor(a);
    const r = o && pick(o);
    if (r) return r;
  }
  return undefined;
}

function collect<T>(cls: Function, pick: (o: Own) => Map<string | undefined, T>): [string, T][] {
  const out: [string, T][] = [];
  for (const a of ancestors(cls)) {
    const o = ownFor(a);
    if (o) for (const e of pick(o)) if (e[0] !== undefined) out.push(e as [string, T]);
  }
  const o = ownFor(cls);
  if (o) for (const e of pick(o)) if (e[0] !== undefined) out.push(e as [string, T]);
  return out;
}

const appliesTo = (o: { toClassOnly?: boolean; toPlainOnly?: boolean } | undefined, t: TransformationType) => {
  if (!o) return true;
  if (o.toClassOnly === true && o.toPlainOnly === true) return true;
  if (o.toClassOnly === true) return t === TransformationType.CLASS_TO_CLASS || t === TransformationType.PLAIN_TO_CLASS;
  if (o.toPlainOnly === true) return t === TransformationType.CLASS_TO_PLAIN;
  return true;
};

export const findTypeMetadata = (cls: Function, prop: string) => find(cls, (o) => o.types.get(prop));
export const findExposeMetadata = (cls: Function, prop: string) => {
  // class-transformer stores one record per property; "found" means a record exists (options may be {})
  const own = ownFor(cls);
  if (own?.expose.has(prop)) return { propertyName: prop, options: own.expose.get(prop)! };
  for (const a of ancestors(cls)) {
    const o = ownFor(a);
    if (o?.expose.has(prop)) return { propertyName: prop, options: o.expose.get(prop)! };
  }
  return undefined;
};
export function findExposeMetadataByCustomName(cls: Function, name: string) {
  return collect(cls, (o) => o.expose).map(([propertyName, options]) => ({ propertyName, options })).find((m) => m.options && m.options.name === name);
}
export function findTransformMetadatas(cls: Function, prop: string, type: TransformationType): TransformMeta[] {
  const fromAncestors: TransformMeta[] = [];
  for (const a of ancestors(cls)) {
    const l = ownFor(a)?.transforms.get(prop);
    if (l) fromAncestors.push(...l);
  }
  const mine = ownFor(cls)?.transforms.get(prop) ?? [];
  return fromAncestors.slice().reverse().concat(mine.slice().reverse()).filter((m) => appliesTo(m.options, type));
}
export function getStrategy(cls: Function): "excludeAll" | "exposeAll" | "none" {
  const own = ownFor(cls);
  const exclude = own?.exclude.has(undefined);
  const expose = own?.expose.has(undefined);
  if ((exclude && expose) || (!exclude && !expose)) return "none";
  return exclude ? "excludeAll" : "exposeAll";
}
export const getExposedProperties = (cls: Function, t: TransformationType) =>
  collect(cls, (o) => o.expose).filter(([, opts]) => appliesTo(opts, t)).map(([p]) => p);
export const getExcludedProperties = (cls: Function, t: TransformationType) =>
  collect(cls, (o) => o.exclude).filter(([, opts]) => appliesTo(opts, t)).map(([p]) => p);

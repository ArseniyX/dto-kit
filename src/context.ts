// Dual-mode decorators: dto-kit decorators work with TC39 standard decorators *and* TypeScript's legacy
// `experimentalDecorators` (which NestJS requires). toContext() turns either calling convention into the
// standard context shape, so the rest of the library only ever sees one.
import "./metadata.js"; // installs Symbol.metadata

export type AnyCtx =
  | ClassFieldDecoratorContext | ClassAccessorDecoratorContext | ClassGetterDecoratorContext
  | ClassSetterDecoratorContext | ClassMethodDecoratorContext | ClassDecoratorContext;

/** Valid as a standard decorator `(value, context)` and as a legacy one `(target, key, descriptor?)`. */
export type MemberDecorator = (a: any, b?: any, c?: any) => void;

/** Metadata object for a legacy-decorated class, linked to its parent's so inheritance works like standard decorators. */
function legacyMetadata(cls: Function): DecoratorMetadataObject {
  if (!Object.prototype.hasOwnProperty.call(cls, Symbol.metadata!)) {
    const parent = Object.getPrototypeOf(cls);
    const parentMd = typeof parent === "function" && parent !== Function.prototype ? (parent as any)[Symbol.metadata!] : undefined;
    Object.defineProperty(cls, Symbol.metadata!, { value: Object.create(parentMd ?? null), writable: true, configurable: true });
  }
  return (cls as any)[Symbol.metadata!];
}

export function toContext(a: unknown, b: unknown, c?: unknown): AnyCtx {
  // standard: (value, context)
  if (typeof b === "object" && b !== null && "kind" in b) return b as AnyCtx;
  const noop = () => {};
  // legacy class decorator: (constructor)
  if (b === undefined && typeof a === "function") {
    return { kind: "class", name: (a as Function).name, metadata: legacyMetadata(a as Function), addInitializer: noop } as unknown as AnyCtx;
  }
  // legacy member decorator: (prototype | constructor, key, descriptor?)
  const isStatic = typeof a === "function";
  const cls = (isStatic ? a : (a as object).constructor) as Function;
  const d = typeof c === "object" && c !== null ? (c as PropertyDescriptor) : undefined;
  const kind = d ? (typeof d.value === "function" ? "method" : d.get ? "getter" : d.set ? "setter" : "field") : "field";
  return { kind, name: b as string | symbol, static: isStatic, private: false, metadata: legacyMetadata(cls), addInitializer: noop } as unknown as AnyCtx;
}

/** Build a decorator that works in both modes from a function of the normalised context. */
export const member = (fn: (ctx: AnyCtx) => void): MemberDecorator => (a, b, c) => {
  fn(toContext(a, b, c));
};

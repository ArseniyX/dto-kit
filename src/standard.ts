import { parseMaybeAsync, type Issue, type ParseOptions, type ParseResult } from "./schema.js";
import type { Ctor } from "./metadata.js";

/** Minimal Standard Schema v1 shape (https://standardschema.dev), inlined to avoid a dependency. */
export interface StandardSchemaV1<T> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown, options?: { readonly libraryOptions?: Record<string, unknown> }) => Result<T> | Promise<Result<T>>;
    readonly types?: { input: unknown; output: T };
  };
}
type Result<T> = { value: T; issues?: undefined } | { issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey> }> };

/**
 * Wrap a DTO class as a Standard Schema (tRPC, TanStack Form, NestJS 12's `@Body({ schema })`, ...).
 * Synchronous unless the DTO has an async rule, in which case `validate()` returns a Promise.
 * Parse options (groups, whitelist, ...) can be passed here or per call via `libraryOptions`.
 */
export function schema<T>(cls: Ctor<T>, opts?: ParseOptions): StandardSchemaV1<T> {
  const toResult = (r: ParseResult<T>): Result<T> => (r.success ? { value: r.value } : { issues: r.issues as Issue[] });
  return {
    "~standard": {
      version: 1,
      vendor: "dto-kit",
      validate(value, options) {
        const merged = { ...opts, ...(options?.libraryOptions as ParseOptions | undefined) };
        const r = parseMaybeAsync(cls, value, merged);
        return r instanceof Promise ? r.then(toResult) : toResult(r);
      },
    },
  };
}

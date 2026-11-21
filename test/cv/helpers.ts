import { parseAsync, type Issue, type ParseOptions } from "../../src/index.js";

/** class-validator-shaped error, rebuilt from dto-kit issues so the original assertions port 1:1. */
export interface CvError {
  property: string;
  constraints?: Record<string, string>;
  contexts?: Record<string, unknown>;
  children: CvError[];
}

function group(issues: Issue[], depth: number): CvError[] {
  const byKey = new Map<string, Issue[]>();
  for (const i of issues) {
    // every path element (property name, array index, Map key) is a node, as in class-validator's error tree
    const key = String(i.path[depth]);
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  }
  return [...byKey].map(([property, list]) => {
    const own = list.filter((i) => i.path.length === depth + 1);
    const deeper = list.filter((i) => i.path.length > depth + 1);
    const err: CvError = { property, children: group(deeper, depth + 1) };
    if (own.length) {
      err.constraints = Object.fromEntries(own.map((i) => [i.code!, i.message]));
      const ctx = own.filter((i) => i.context !== undefined);
      if (ctx.length) err.contexts = Object.fromEntries(ctx.map((i) => [i.code!, i.context]));
    }
    return err;
  });
}

/** Equivalent of class-validator's `validator.validate(model, options)`. */
export async function validate(model: object, opts?: ParseOptions): Promise<CvError[]> {
  const r = await parseAsync(model.constructor as new () => object, model, opts);
  return r.success ? [] : group(r.issues, 0);
}

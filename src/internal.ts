import { fieldMeta, type Rule } from "./metadata.js";
import { member, type MemberDecorator } from "./context.js";
import type { ValidationOptions } from "./validation.js";

export type FieldDecorator = MemberDecorator;
export type FieldCtx = { readonly name: string | symbol; readonly metadata: unknown };

/** Register a rule. `name` becomes Issue.code; `constraints` feed the $constraintN message tokens. */
export const rule = (name: string, check: Rule, opts?: ValidationOptions, constraints: unknown[] = [], raw = false): FieldDecorator =>
  member((ctx) => {
    fieldMeta(ctx).rules.push({ name, check, constraints, opts: opts ?? {}, raw });
  });

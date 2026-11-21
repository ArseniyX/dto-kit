import { rule, type FieldDecorator } from "./internal.js";
import { toContext, type AnyCtx } from "./context.js";
import { isValidationOptions, type ValidationArguments, type ValidationOptions } from "./validation.js";

export interface ValidatorConstraintInterface {
  /** Return true when valid. May return a Promise (then use parseAsync). */
  validate(value: any, args: ValidationArguments): boolean | Promise<boolean>;
  defaultMessage?(args: ValidationArguments): string;
}
type ConstraintClass = new () => ValidatorConstraintInterface;
interface ConstraintOptions {
  name?: string;
  async?: boolean;
}
const registry = new WeakMap<object, ConstraintOptions>();
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Class decorator: marks a class as a reusable constraint for @Validate() / registerDecorator(). */
export const ValidatorConstraint =
  (opts: ConstraintOptions = {}) =>
  (target: new (...a: any[]) => ValidatorConstraintInterface, _ctx?: ClassDecoratorContext) => {
    registry.set(target, opts);
  };

function constraintRule(inst: ValidatorConstraintInterface, name: string, constraints: unknown[], o?: ValidationOptions): FieldDecorator {
  const fail = (args: ValidationArguments) => inst.defaultMessage?.(args) || `${name} failed`;
  return rule(
    name,
    (value, _obj, args) => {
      const r = inst.validate(value, args);
      return typeof (r as Promise<boolean>)?.then === "function"
        ? (r as Promise<boolean>).then((ok) => (ok ? undefined : fail(args)))
        : (r as boolean) ? undefined : fail(args);
    },
    o,
    constraints,
    true, // defaultMessage() returns the final text (it may use buildMessage for the "each" prefix)
  );
}

/** `@Validate(MyConstraint)`, `@Validate(MyConstraint, [c1, c2], opts?)` or `@Validate(MyConstraint, opts)`. */
export function Validate(
  cls: ConstraintClass,
  constraintsOrOptions?: unknown[] | ValidationOptions,
  maybeOptions?: ValidationOptions,
): FieldDecorator {
  const constraints = Array.isArray(constraintsOrOptions) ? constraintsOrOptions : [];
  const o = Array.isArray(constraintsOrOptions) ? maybeOptions : isValidationOptions(constraintsOrOptions) ? constraintsOrOptions : maybeOptions;
  return constraintRule(new cls(), registry.get(cls)?.name ?? lowerFirst(cls.name), constraints, o);
}

export interface ValidationDecoratorOptions {
  /**
   * Standard decorators: the context your decorator function receives, `(_value, context) => registerDecorator({ context, ... })`.
   * Legacy decorators (NestJS, class-validator style): pass `target: object.constructor, propertyName` instead.
   */
  context?: AnyCtx;
  /** Legacy (experimentalDecorators / class-validator style) alternative to `context`: the class and property name. */
  target?: Function;
  propertyName?: string;
  /** Becomes Issue.code. Defaults to the constraint's @ValidatorConstraint name, else "customValidation". */
  name?: string;
  async?: boolean;
  options?: ValidationOptions;
  constraints?: unknown[];
  /** An inline validator object, or a class decorated with @ValidatorConstraint. */
  validator: ValidatorConstraintInterface | ConstraintClass;
}

/** Register a custom validation rule on the field being decorated. */
export function registerDecorator(o: ValidationDecoratorOptions): void {
  const isClass = typeof o.validator === "function";
  const inst = isClass ? new (o.validator as ConstraintClass)() : (o.validator as ValidatorConstraintInterface);
  const name =
    o.name ?? (isClass ? (registry.get(o.validator)?.name ?? lowerFirst((o.validator as ConstraintClass).name)) : "customValidation");
  const ctx = o.context ?? (o.target ? toContext(o.target.prototype, o.propertyName) : undefined);
  if (!ctx) throw new Error("dto-kit registerDecorator: pass `context` (standard decorators) or `target` + `propertyName` (legacy)");
  constraintRule(inst, name, o.constraints ?? [], o.options)(undefined, ctx);
}

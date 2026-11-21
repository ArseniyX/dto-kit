import * as dtoKit from "../index.js";
import * as nest from "../nest.js";

/** Runtime exports of "dto-kit" (what a named import can resolve to). */
export const DTO_KIT_VALUES: ReadonlySet<string> = new Set(Object.keys(dtoKit));
export const DTO_KIT_NEST_VALUES: ReadonlySet<string> = new Set(Object.keys(nest));
/** Type-only exports of "dto-kit" (invisible at runtime). Kept honest by test/codemod/manifest.test.ts. */
export const DTO_KIT_TYPES: readonly string[] = [
  "ValidationOptions", "ValidationArguments", "ValidatorConstraintInterface", "ValidationDecoratorOptions",
  "Issue", "ParseResult", "ParseOptions", "StandardSchemaV1", "MemberDecorator", "FieldDecorator",
  "ClassTransformOptions", "ExposeOptions", "ExcludeOptions", "TypeOptions", "TypeHelpOptions", "TransformFnParams",
  "TransformOptions", "TargetMap", "ClassConstructor",
];
export const DTO_KIT_TYPE_SET: ReadonlySet<string> = new Set(DTO_KIT_TYPES);

/** Same behaviour, different name. */
export const RENAMES: Readonly<Record<string, string>> = {
  IsUrl: "IsURL",
  IsNumberString: "IsNumericString",
  IsDateString: "IsISO8601",
};

export const isAvailable = (name: string) => DTO_KIT_VALUES.has(name) || DTO_KIT_TYPE_SET.has(name);

/** Why a name can't be moved over automatically. */
export function unavailableReason(name: string): string {
  if (/^(validate|validateSync|validateOrReject|Validator|ValidationError|ValidationTypes|getMetadataStorage|MetadataStorage|useContainer|getFromContainer)$/.test(name))
    return "class-validator's Validator API has no direct equivalent: use parse() / parseAsync() / parseOrThrow() (they return Issue[] instead of ValidationError[])";
  if (name === "ValidatorOptions") return "use ParseOptions (not identical: no forbidUnknownValues)";
  if (name === "IsEmpty") return "not supported: dto-kit treats null/undefined as missing before any rule runs";
  if (/^[a-z]/.test(name)) return "standalone predicate functions aren't provided; use the decorator, or validator.js directly";
  if (/^(ValidatePromise|ValidateBy|ValidationSchema|registerSchema|IsISO|IsPhoneNumber|IsMilitaryTime|IsTimeZone)/.test(name)) return "not implemented in dto-kit yet";
  return "not available in dto-kit";
}

import { describe, expect, it } from "vitest";
import * as dtoKit from "../../src/index.js";
import { DTO_KIT_TYPES, DTO_KIT_VALUES, RENAMES, isAvailable } from "../../src/codemod/manifest.js";
// If a type listed here stops being exported from "dto-kit", this file stops compiling (npm run typecheck).
import type {
  ClassConstructor, ClassTransformOptions, ExcludeOptions, ExposeOptions, FieldDecorator, Issue, MemberDecorator, ParseOptions,
  ParseResult, StandardSchemaV1, TargetMap, TransformFnParams, TransformOptions, TypeHelpOptions, TypeOptions,
  ValidationArguments, ValidationDecoratorOptions, ValidationOptions, ValidatorConstraintInterface,
} from "../../src/index.js";

type Listed = [
  ClassConstructor<unknown>, ClassTransformOptions, ExcludeOptions, ExposeOptions, FieldDecorator, Issue, MemberDecorator, ParseOptions,
  ParseResult<unknown>, StandardSchemaV1<unknown>, TargetMap, TransformFnParams, TransformOptions, TypeHelpOptions, TypeOptions,
  ValidationArguments, ValidationDecoratorOptions, ValidationOptions, ValidatorConstraintInterface,
];
const LISTED_TYPE_NAMES = [
  "ClassConstructor", "ClassTransformOptions", "ExcludeOptions", "ExposeOptions", "FieldDecorator", "Issue", "MemberDecorator", "ParseOptions",
  "ParseResult", "StandardSchemaV1", "TargetMap", "TransformFnParams", "TransformOptions", "TypeHelpOptions", "TypeOptions",
  "ValidationArguments", "ValidationDecoratorOptions", "ValidationOptions", "ValidatorConstraintInterface",
];
void (null as unknown as Listed);

describe("codemod manifest", () => {
  it("lists exactly the type exports checked at compile time above", () => {
    expect([...DTO_KIT_TYPES].sort()).toEqual([...LISTED_TYPE_NAMES].sort());
  });

  it("knows every runtime export of dto-kit", () => {
    expect([...DTO_KIT_VALUES].sort()).toEqual(Object.keys(dtoKit).sort());
  });

  it("every rename target really exists", () => {
    for (const to of Object.values(RENAMES)) expect(isAvailable(to), to).toBe(true);
  });

  it("the class-validator names its README claims are covered resolve", () => {
    for (const n of ["IsString", "IsEmail", "IsOptional", "IsDefined", "Allow", "ValidateNested", "Validate", "ValidatorConstraint", "registerDecorator", "buildMessage", "Expose", "Exclude", "Type", "Transform", "plainToInstance", "instanceToPlain", "classToPlain", "plainToClass"]) {
      expect(isAvailable(n), n).toBe(true);
    }
  });
});

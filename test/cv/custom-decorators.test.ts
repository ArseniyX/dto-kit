// Ported from typestack/class-validator test/functional/custom-decorators.spec.ts
// (MIT, Copyright (c) 2015-2020 TypeStack).
// Port notes: dto-kit uses standard decorators, so `registerDecorator({ target: object.constructor, propertyName })`
// becomes `registerDecorator({ context })` where `context` is the decorator context.
import { describe, expect, it } from "vitest";
import {
  buildMessage, registerDecorator, ValidatorConstraint,
  type ValidationArguments, type ValidationOptions, type ValidatorConstraintInterface,
} from "../../src/index.js";
import { validate } from "./helpers.js";

describe("decorator with inline validation", () => {
  function IsLongerThan(property: string, validationOptions?: ValidationOptions) {
    return function (_value: undefined, context: ClassFieldDecoratorContext): void {
      registerDecorator({
        context,
        options: validationOptions,
        constraints: [property],
        name: "isLongerThan",
        validator: {
          validate(value: any, args: ValidationArguments): Promise<boolean> | boolean {
            const [relatedPropertyName] = args.constraints as [string];
            const relatedValue = (args.object as any)[relatedPropertyName];
            if (relatedValue === undefined || relatedValue === null) return true;
            const result = typeof value === "string" && typeof relatedValue === "string" && value.length > relatedValue.length;
            const asPromise = validationOptions && (validationOptions.context as any)?.promise;
            return asPromise ? Promise.resolve(result) : result;
          },
        },
      });
    };
  }

  class MyClass {
    @IsLongerThan("lastName", {
      context: { foo: "bar" },
      message: "$property must be longer then $constraint1. Given value: $value",
    })
    firstName!: string;
    lastName?: string;
  }
  class MyClassWithAsyncValidator {
    @IsLongerThan("lastName", {
      context: { foo: "bar", promise: true },
      message: "$property must be longer then $constraint1. Given value: $value",
    })
    firstName!: string;
    lastName?: string;
  }

  it("if firstName is not empty and lastLame is empty then it should succeed", async () => {
    const model = new MyClass();
    model.firstName = "hell no world";
    expect(await validate(model)).toHaveLength(0);
  });

  it("if firstName is empty and lastLame is not empty then it should fail", async () => {
    const model = new MyClass();
    model.firstName = "";
    model.lastName = "Kim";
    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ isLongerThan: "firstName must be longer then lastName. Given value: " });
  });

  it("if firstName is shorter then lastLame then it should fail", async () => {
    const model = new MyClass();
    model.firstName = "Li";
    model.lastName = "Kim";
    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ isLongerThan: "firstName must be longer then lastName. Given value: Li" });
  });

  it("should include context", async () => {
    const model = new MyClass();
    const asyncModel = new MyClassWithAsyncValidator();
    model.firstName = asyncModel.firstName = "Paul";
    model.lastName = asyncModel.lastName = "Walker";

    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.contexts).toEqual({ isLongerThan: { foo: "bar" } });
    const asyncErrors = await validate(asyncModel);
    expect(asyncErrors.length).toEqual(1);
    expect(asyncErrors[0]!.contexts).toHaveProperty("isLongerThan.foo", "bar");
  });
});

describe("decorator with default message", () => {
  function IsLonger(property: string, validationOptions?: ValidationOptions) {
    return function (_value: undefined, context: ClassFieldDecoratorContext): void {
      registerDecorator({
        context,
        options: validationOptions,
        constraints: [property],
        name: "isLonger",
        validator: {
          validate(value: any, args: ValidationArguments): boolean {
            const [relatedPropertyName] = args.constraints as [string];
            const relatedValue = (args.object as any)[relatedPropertyName];
            if (relatedValue === undefined || relatedValue === null) return true;
            return typeof value === "string" && typeof relatedValue === "string" && value.length > relatedValue.length;
          },
          defaultMessage(args: ValidationArguments): string {
            return args.property + " must be longer then " + args.constraints[0];
          },
        },
      });
    };
  }
  class SecondClass {
    @IsLonger("lastName") firstName!: string;
    lastName?: string;
  }

  it("if firstName is not empty and lastLame is empty then it should succeed", async () => {
    const model = new SecondClass();
    model.firstName = "hell no world";
    expect(await validate(model)).toHaveLength(0);
  });
  it("if firstName is empty and lastLame is not empty then it should fail", async () => {
    const model = Object.assign(new SecondClass(), { firstName: "", lastName: "Kim" });
    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ isLonger: "firstName must be longer then lastName" });
  });
  it("if firstName is shorter then lastLame then it should fail", async () => {
    const model = Object.assign(new SecondClass(), { firstName: "Li", lastName: "Kim" });
    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ isLonger: "firstName must be longer then lastName" });
  });
});

describe("decorator with separate validation constraint class", () => {
  @ValidatorConstraint({ name: "isShortenThan" })
  class IsShortenThanConstraint implements ValidatorConstraintInterface {
    validate(value: any, args: ValidationArguments): boolean {
      const [relatedPropertyName] = args.constraints as [string];
      const relatedValue = (args.object as any)[relatedPropertyName];
      if (value === null || value === undefined) return true;
      return typeof value === "string" && typeof relatedValue === "string" && value.length < relatedValue.length;
    }
  }
  function IsShorterThan(property: string, validationOptions?: ValidationOptions) {
    return function (_value: undefined, context: ClassFieldDecoratorContext): void {
      registerDecorator({ context, options: validationOptions, constraints: [property], validator: IsShortenThanConstraint });
    };
  }
  class MyClass {
    firstName?: string;
    @IsShorterThan("firstName", { message: "$property must be shorter then $constraint1. Given value: $value" })
    lastName!: string;
  }

  it("if firstName is not empty and lastLame is empty then it should succeed", async () => {
    // (original leaves lastName undefined and the constraint accepts that; dto-kit would report a missing required field)
    const model = Object.assign(new MyClass(), { firstName: "hell no world", lastName: "Kim" });
    expect(await validate(model)).toHaveLength(0);
  });
  it("if firstName is empty and lastLame is not empty then it should fail", async () => {
    const model = Object.assign(new MyClass(), { firstName: "", lastName: "Kim" });
    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ isShortenThan: "lastName must be shorter then firstName. Given value: Kim" });
  });
  it("if firstName is shorter then lastLame then it should fail", async () => {
    const model = Object.assign(new MyClass(), { firstName: "Li", lastName: "Kim" });
    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ isShortenThan: "lastName must be shorter then firstName. Given value: Kim" });
  });
});

describe("decorator with symbol constraint", () => {
  const mySymbol = Symbol("mySymbol");
  function IsSameType(property: unknown, validationOptions?: ValidationOptions) {
    return function (_value: undefined, context: ClassFieldDecoratorContext): void {
      registerDecorator({
        context,
        options: validationOptions,
        constraints: [property],
        validator: {
          validate: (value: any, args: ValidationArguments) => typeof value === typeof args.constraints[0],
          defaultMessage: buildMessage((eachPrefix) => eachPrefix + "$property must be of type " + typeof property, validationOptions),
        },
      });
    };
  }
  class MyClass {
    @IsSameType(mySymbol) property!: symbol;
  }

  it("if property is not a symbol then it should fail", async () => {
    // (original leaves `property` undefined; dto-kit reports a missing value as "required", so give it a wrong type)
    const model = new MyClass();
    (model as any).property = "not a symbol";
    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints!["customValidation"]).toEqual("property must be of type symbol");
  });

  it("buildMessage adds the each prefix without it being duplicated", async () => {
    class Each {
      @IsSameType("x", { each: true }) values!: unknown;
    }
    const errors = await validate(Object.assign(new Each(), { values: ["a", 1] }));
    expect(errors[0]!.constraints!["customValidation"]).toEqual("each value in values must be of type string");
  });
});

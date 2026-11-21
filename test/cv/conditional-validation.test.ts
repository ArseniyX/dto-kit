// Ported from typestack/class-validator test/functional/conditional-validation.spec.ts
// (MIT, Copyright (c) 2015-2020 TypeStack).
import { describe, expect, it } from "vitest";
import { Equals, IsNotEmpty, IsOptional, ValidateIf } from "../../src/index.js";
import { validate } from "./helpers.js";

describe("conditional validation", () => {
  it("shouldn't validate a property when the condition is false", async () => {
    class MyClass {
      @ValidateIf(() => false)
      @IsNotEmpty()
      title!: string;
    }
    expect(await validate(new MyClass())).toHaveLength(0);
  });

  it("should validate a property when the condition is true", async () => {
    class MyClass {
      @ValidateIf(() => true)
      @IsNotEmpty()
      title: string = "";
    }
    const errors = await validate(new MyClass());
    expect(errors.length).toEqual(1);
    expect(errors[0]!.property).toEqual("title");
    expect(Object.keys(errors[0]!.constraints!)).toEqual(["isNotEmpty"]);
  });

  it("should pass the object being validated to the condition function", async () => {
    let seen: unknown;
    class MyClass {
      @ValidateIf((o) => {
        seen = o;
        return true;
      })
      @IsNotEmpty()
      title: string = "title";
    }
    const model = new MyClass();
    expect(await validate(model)).toHaveLength(0);
    expect(seen).toBeInstanceOf(MyClass);
    expect((seen as MyClass).title).toEqual("title");
  });

  it("should validate a property when value is empty", async () => {
    class MyClass {
      @IsOptional()
      @Equals("test")
      title: string = "";
    }
    const errors = await validate(new MyClass());
    expect(errors.length).toEqual(1);
    expect(errors[0]!.property).toEqual("title");
    expect(Object.keys(errors[0]!.constraints!)).toEqual(["equals"]);
  });

  it("should validate a property when value is supplied", async () => {
    class MyClass {
      @IsOptional()
      @Equals("test")
      title: string = "bad_value";
    }
    const errors = await validate(new MyClass());
    expect(errors.length).toEqual(1);
    expect(errors[0]!.property).toEqual("title");
    expect(Object.keys(errors[0]!.constraints!)).toEqual(["equals"]);
  });

  it("an optional property that is missing is skipped", async () => {
    class MyClass {
      @IsOptional() @Equals("test") title?: string;
    }
    expect(await validate(new MyClass())).toHaveLength(0);
  });
});

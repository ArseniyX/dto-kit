// Ported from typestack/class-validator test/functional/whitelist-validation.spec.ts
// (MIT, Copyright (c) 2015-2020 TypeStack).
// Port note: class-validator strips properties off the instance you pass in. dto-kit builds a new instance, so
// unknown keys are dropped from the *result* (the input is never mutated) and whitelisting is on by default.
import { describe, expect, it } from "vitest";
import { Allow, IsDefined, IsOptional, Min, parse, parseAsync } from "../../src/index.js";
import { validate } from "./helpers.js";

describe("whitelist validation", () => {
  it("should strip non whitelisted properties, but leave whitelisted untouched", async () => {
    class MyClass {
      @IsDefined() title!: string;
      @Min(0) views!: number;
    }
    const model: any = Object.assign(new MyClass(), { title: "hello", views: 56, unallowedProperty: 42 });
    const r = await parseAsync(MyClass, model, { whitelist: true });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.value as any).unallowedProperty).toBeUndefined();
      expect(r.value.title).toEqual("hello");
      expect(r.value.views).toEqual(56);
    }
    expect(model.unallowedProperty).toEqual(42); // input untouched
  });

  it("should be able to whitelist with @Allow", async () => {
    class MyClass {
      @Allow() views!: number;
    }
    const model: any = Object.assign(new MyClass(), { views: 420, unallowedProperty: "non-whitelisted" });
    const r = parse(MyClass, model, { whitelist: true });
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.value as any).unallowedProperty).toBeUndefined();
      expect(r.value.views).toEqual(420);
    }
  });

  it("@Allow lets the property be missing", () => {
    class MyClass {
      @Allow() views?: number;
    }
    expect(parse(MyClass, {}).success).toBe(true);
  });

  it("should throw an error when forbidNonWhitelisted flag is set", async () => {
    class MyPayload {
      @IsOptional() propertyToRegisterClass?: string;
      nonDecorated: string;
      constructor(nonDecorated = "") {
        this.nonDecorated = nonDecorated;
      }
    }
    const instance = new MyPayload("non-whitelisted");
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.length).toEqual(1);
    expect(errors[0]!.property).toEqual("nonDecorated");
    expect(errors[0]!.constraints).toHaveProperty("whitelistValidation");
  });

  it("whitelist: false keeps unknown properties on the result", () => {
    class MyClass {
      @Min(0) views!: number;
    }
    const r = parse(MyClass, { views: 1, extra: "kept" }, { whitelist: false });
    expect(r.success && (r.value as any).extra).toBe("kept");
  });

  it("strict is the same as forbidNonWhitelisted", () => {
    class MyClass {
      @Min(0) views!: number;
    }
    const r = parse(MyClass, { views: 1, extra: 1 }, { strict: true });
    expect(!r.success && r.issues[0]?.code).toBe("whitelistValidation");
  });
});

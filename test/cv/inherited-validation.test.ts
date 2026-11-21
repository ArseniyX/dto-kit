// Ported from typestack/class-validator test/functional/inherited-validation.spec.ts
// (MIT, Copyright (c) 2015-2020 TypeStack).
import { describe, expect, it } from "vitest";
import { Contains, MinLength } from "../../src/index.js";
import { validate } from "./helpers.js";

describe("inherited validation", () => {
  it("should validate inherited properties", async () => {
    class MyClass {
      @Contains("hello") title!: string;
    }
    class MySubClass extends MyClass {
      @MinLength(5) name!: string;
    }
    const model = Object.assign(new MySubClass(), { title: "helo world", name: "my" });
    const errors = await validate(model);
    expect(errors.length).toEqual(2);
    // Port note: class-validator reports the subclass's own properties first; dto-kit lists inherited fields
    // first (declaration order, parent before child). Same errors, different order.
    const byProp = Object.fromEntries(errors.map((e) => [e.property, Object.keys(e.constraints!)]));
    expect(byProp).toEqual({ name: ["minLength"], title: ["contains"] });
    expect(errors.map((e) => e.property)).toEqual(["title", "name"]);
  });

  it("does not leak subclass rules into the parent", async () => {
    class Base {
      @Contains("hello") title!: string;
    }
    class Child extends Base {
      @MinLength(5) name!: string;
    }
    void Child;
    expect(await validate(Object.assign(new Base(), { title: "hello" }))).toHaveLength(0);
  });
});

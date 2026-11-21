// Ported from typestack/class-validator test/functional/nested-validation.spec.ts
// (MIT, Copyright (c) 2015-2020 TypeStack). Assertions on `target`/`value` and on default message text are replaced by
// checks on property paths and rule codes; the nested-error tree shape is kept (see helpers.ts).
import { describe, expect, it } from "vitest";
import { Contains, MinLength, Nested, ValidateNested, parse } from "../../src/index.js";
import { validate } from "./helpers.js";

class MySubClass {
  @MinLength(5) name!: string;
}
const sub = (name: string) => Object.assign(new MySubClass(), { name });
const minLength = { minLength: expect.any(String) };

describe("nested validation", () => {
  it("should not validate missing nested objects", async () => {
    class MyClass {
      @Contains("hello") title!: string;
      @ValidateNested() mySubClass!: MySubClass; // (original adds @IsDefined(); a missing value is already "required")
    }
    const model = Object.assign(new MyClass(), { title: "helo" });
    const errors = await validate(model);
    expect(errors[1]!.property).toEqual("mySubClass");
    expect(Object.keys(errors[1]!.constraints!)).toEqual(["isDefined"]);
  });

  it("should validate nested objects", async () => {
    class MyClass {
      @Contains("hello") title!: string;
      @ValidateNested() mySubClass!: MySubClass;
      @ValidateNested() mySubClasses!: MySubClass[];
      @ValidateNested() mySubSubClasses!: MySubClass[][];
      @ValidateNested() mySubSubSubClasses!: MySubClass[][][];
    }
    const model = Object.assign(new MyClass(), {
      title: "helo world",
      mySubClass: sub("my"),
      mySubClasses: [sub("my"), sub("not-short")],
      mySubSubClasses: [[sub("sub")]],
      mySubSubSubClasses: [[[sub("sub")]]],
    });
    const errors = await validate(model);
    expect(errors.length).toEqual(5);

    expect(errors[0]!.property).toEqual("title");
    expect(errors[0]!.constraints).toEqual({ contains: expect.any(String) });

    expect(errors[1]!.property).toEqual("mySubClass");
    expect(errors[1]!.constraints).toBeUndefined();
    expect(errors[1]!.children[0]!.property).toEqual("name");
    expect(errors[1]!.children[0]!.constraints).toEqual(minLength);

    // arrays nest one level per dimension: property -> index -> (index ->)* -> field
    expect(errors[2]!.property).toEqual("mySubClasses");
    expect(errors[2]!.constraints).toBeUndefined();
    expect(errors[2]!.children.map((c) => c.property)).toEqual(["0"]); // only index 0 is invalid
    expect(errors[2]!.children[0]!.children[0]!.property).toEqual("name");
    expect(errors[2]!.children[0]!.children[0]!.constraints).toEqual(minLength);

    expect(errors[3]!.property).toEqual("mySubSubClasses");
    const l3 = errors[3]!.children[0]!.children[0]!;
    expect(errors[3]!.children[0]!.property).toEqual("0");
    expect(l3.property).toEqual("0");
    expect(l3.children[0]!.property).toEqual("name");
    expect(l3.children[0]!.constraints).toEqual(minLength);

    expect(errors[4]!.property).toEqual("mySubSubSubClasses");
    const l4 = errors[4]!.children[0]!.children[0]!.children[0]!;
    expect(l4.property).toEqual("0");
    expect(l4.children[0]!.property).toEqual("name");
    expect(l4.children[0]!.constraints).toEqual(minLength);
  });

  it("should validate when nested is not object", async () => {
    class MyClass {
      @ValidateNested() mySubClass!: MySubClass;
    }
    const model = new MyClass();
    model.mySubClass = "invalidnested object" as any;
    const errors = await validate(model);
    expect(errors[0]!.property).toEqual("mySubClass");
    expect(errors[0]!.children.length).toEqual(0);
    expect(Object.keys(errors[0]!.constraints!)).toEqual(["nestedValidation"]);
  });

  it("should validate nested set", async () => {
    class MyClass {
      @Contains("hello") title!: string;
      @ValidateNested() mySubClass!: MySubClass;
      @ValidateNested() mySubClasses!: Set<MySubClass>;
    }
    const model = Object.assign(new MyClass(), {
      title: "helo world",
      mySubClass: sub("my"),
      mySubClasses: new Set([sub("my"), sub("not-short")]),
    });
    const errors = await validate(model);
    expect(errors.length).toEqual(3);
    expect(errors[1]!.children[0]!.property).toEqual("name");
    expect(errors[2]!.property).toEqual("mySubClasses");
    expect(errors[2]!.constraints).toBeUndefined();
    expect(errors[2]!.children.map((c) => c.property)).toEqual(["0"]);
    expect(errors[2]!.children[0]!.children[0]!.property).toEqual("name");
    expect(errors[2]!.children[0]!.children[0]!.constraints).toEqual(minLength);
  });

  it("should validate nested map", async () => {
    class MyClass {
      @Contains("hello") title!: string;
      @ValidateNested() mySubClass!: MySubClass;
      @ValidateNested() mySubClasses!: Map<string, MySubClass>;
    }
    const model = Object.assign(new MyClass(), {
      title: "helo world",
      mySubClass: sub("my"),
      mySubClasses: new Map([["key1", sub("my")], ["key2", sub("not-short")]]),
    });
    const errors = await validate(model);
    expect(errors.length).toEqual(3);
    expect(errors[2]!.property).toEqual("mySubClasses");
    expect(errors[2]!.constraints).toBeUndefined();
    expect(errors[2]!.children.map((c) => c.property)).toEqual(["key1"]); // Map entries are keyed by their Map key
    expect(errors[2]!.children[0]!.children[0]!.property).toEqual("name");
    expect(errors[2]!.children[0]!.children[0]!.constraints).toEqual(minLength);
  });

  it("nestedValidation should be defined as an error for the property specifying the decorator when validation fails.", async () => {
    class MyClass {
      @ValidateNested() nestedWithClassValue!: MySubClass;
      @ValidateNested() nestedWithPrimitiveValue!: MySubClass;
    }
    const model = new MyClass();
    model.nestedWithClassValue = sub("my"); // (original leaves `name` undefined; dto-kit would report it as required)
    model.nestedWithPrimitiveValue = "invalid" as any;
    const errors = await validate(model, { stopAtFirstError: true });
    expect(errors[0]!.property).toEqual("nestedWithClassValue");
    expect(errors[0]!.children.length).toEqual(1);
    expect(errors[0]!.children[0]!.constraints).toHaveProperty("minLength");
    expect(errors[1]!.property).toEqual("nestedWithPrimitiveValue");
    expect(errors[1]!.constraints).toHaveProperty("nestedValidation");
  });
});

// dto-kit's own use case: plain JSON in, class instances out (no instances needed up front)
describe("nested validation of plain input (explicit type)", () => {
  class Order {
    @Nested(() => MySubClass) main!: MySubClass;
    @Nested(() => MySubClass) items!: MySubClass[];
    @Nested(() => MySubClass) byKey!: Map<string, MySubClass>;
  }

  it("builds class instances (arrays, Maps) from plain objects", () => {
    const r = parse(Order, {
      main: { name: "long-enough" },
      items: [{ name: "long-enough" }, { name: "also-ok-name" }],
      byKey: new Map([["a", { name: "long-enough" }]]),
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.main).toBeInstanceOf(MySubClass);
      expect(r.value.items[1]).toBeInstanceOf(MySubClass);
      expect(r.value.byKey.get("a")).toBeInstanceOf(MySubClass);
    }
  });

  it("reports paths through arrays and Maps", () => {
    const r = parse(Order, {
      main: { name: "x" },
      items: [{ name: "long-enough" }, { name: "x" }],
      byKey: new Map([["k", { name: "x" }]]),
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.map((i) => i.path.join("."))).toEqual(["main.name", "items.1.name", "byKey.k.name"]);
  });

  it("without a type, plain objects can't be validated and say so", () => {
    class NoType {
      @ValidateNested() sub!: unknown;
    }
    const r = parse(NoType, { sub: { name: "long-enough" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.issues[0]!.code).toBe("nestedValidation");
      expect(r.issues[0]!.message).toMatch(/@Nested/);
    }
  });

  it("with { each: true } the value must be an array", () => {
    class Strict {
      @Nested(() => MySubClass, { each: true }) items!: MySubClass[];
    }
    expect(parse(Strict, { items: { name: "long-enough" } }).success).toBe(false);
    expect(parse(Strict, { items: [{ name: "long-enough" }] }).success).toBe(true);
  });
});

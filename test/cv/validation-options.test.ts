// Ported from typestack/class-validator test/functional/validation-options.spec.ts
// (MIT, Copyright (c) 2015-2020 TypeStack). Assertions on class-validator's default message text and on
// its `target`/`value` error fields are replaced by checks on rule codes (dto-kit reports Issues, see helpers.ts).
import { describe, expect, it } from "vitest";
import {
  Contains, Equals, IsArray, IsDefined, Matches, Max, Min, MinLength, Nested, Validate, ValidatorConstraint, registerDecorator,
  type ValidationArguments, type ValidationOptions, type ValidatorConstraintInterface,
} from "../../src/index.js";
import { validate } from "./helpers.js";

describe("message", () => {
  it("should contain a custom message", async () => {
    class MyClass {
      @Contains("hello", { message: "String is not valid. You string must contain a hello word" })
      someProperty!: string;
    }
    const model = new MyClass();
    model.someProperty = "hell no world"; // (original leaves it undefined; dto-kit reports that as "required")
    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ contains: "String is not valid. You string must contain a hello word" });
  });

  it("$value token should be replaced in a custom message", async () => {
    class MyClass {
      @Contains("hello", { message: "$value is not valid. You string must contain a hello word" })
      someProperty!: string;
    }
    const model = new MyClass();
    model.someProperty = "hell no world";
    const errors = await validate(model);
    expect(errors[0]!.constraints).toEqual({ contains: "hell no world is not valid. You string must contain a hello word" });
  });

  it("$value token should be replaced in a custom message with a string", async () => {
    class MyClass {
      @MinLength(2, {
        message: (args) => (String(args.value).length < 2 ? "$value is too short, minimum length is $constraint1 characters $property" : undefined),
      })
      name!: string;
    }
    const model = new MyClass();
    model.name = "";
    // '' is a "missing" value in dto-kit only if null/undefined, so the rule runs
    const errors = await validate(model);
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ minLength: " is too short, minimum length is 2 characters name" });
  });

  it("$value token should be replaced in a custom message with a number", async () => {
    class MyClass {
      @Max(100, { message: "Maximum value is $constraint1, but actual is $value" })
      val: number = 50;
    }
    const model = new MyClass();
    model.val = 101;
    expect((await validate(model))[0]!.constraints).toEqual({ max: "Maximum value is 100, but actual is 101" });
  });

  it("$value token should be replaced in a custom message with a boolean", async () => {
    class MyClass {
      @Equals(true, { message: "Value must be $constraint1, but actual is $value" })
      val: boolean = false;
    }
    expect((await validate(new MyClass()))[0]!.constraints).toEqual({ equals: "Value must be true, but actual is false" });
  });

  it("$constraint1 token should be replaced in a custom message", async () => {
    class MyClass {
      @Contains("hello", { message: "String is not valid. You string must contain a $constraint1 word" })
      someProperty!: string;
    }
    const model = new MyClass();
    model.someProperty = "hell no world";
    expect((await validate(model))[0]!.constraints).toEqual({ contains: "String is not valid. You string must contain a hello word" });
  });

  it("$target token should be replaced in a custom message", async () => {
    class MyClass {
      @Contains("hello", { message: "$target is not valid." })
      someProperty!: string;
    }
    const model = new MyClass();
    model.someProperty = "hell no world";
    expect((await validate(model))[0]!.constraints).toEqual({ contains: "MyClass is not valid." });
  });

  it("$property token should be replaced in a custom message", async () => {
    class MyClass {
      @Contains("hello", { message: "$property is not valid." })
      someProperty!: string;
    }
    const model = new MyClass();
    model.someProperty = "hell no world";
    expect((await validate(model))[0]!.constraints).toEqual({ contains: "someProperty is not valid." });
  });

  it("should replace all token", async () => {
    class MyClass {
      @Contains("hello", { message: "$target#$property is not valid: $value must contain a $constraint1 word" })
      someProperty!: string;
    }
    const model = new MyClass();
    model.someProperty = "hell no world";
    expect((await validate(model))[0]!.constraints).toEqual({
      contains: "MyClass#someProperty is not valid: hell no world must contain a hello word",
    });
  });
});

describe("each", () => {
  const words = ["hell no world", "hello", "helo world", "hello world", "hello dear friend"];
  const containers: [string, (xs: string[]) => unknown, (v: unknown) => boolean][] = [
    ["Array", (xs) => xs, (v) => Array.isArray(v)],
    ["Set", (xs) => new Set(xs), (v) => v instanceof Set],
    ["Map", (xs) => new Map(xs.map((x, i) => [`key${i + 1}`, x])), (v) => v instanceof Map],
  ];

  for (const [kind, make, isKind] of containers) {
    describe(kind, () => {
      it(`should apply validation to each item in the ${kind}`, async () => {
        class MyClass {
          @Contains("hello", { each: true })
          someProperty!: unknown;
        }
        const model = new MyClass();
        model.someProperty = make(words);
        const errors = await validate(model);
        expect(errors.length).toEqual(1);
        expect(Object.keys(errors[0]!.constraints!)).toEqual(["contains"]);
        expect(errors[0]!.property).toEqual("someProperty");
      });

      it(`should apply validation via custom constraint class to ${kind} items (but not ${kind} itself)`, async () => {
        @ValidatorConstraint({ name: "customIsNotContainerConstraint", async: false })
        class CustomIsNotContainer implements ValidatorConstraintInterface {
          validate(value: any): boolean {
            return !isKind(value);
          }
        }
        class MyClass {
          @Validate(CustomIsNotContainer, { each: true })
          someArrayOfNonArrayItems!: unknown;
        }
        const model = new MyClass();
        model.someArrayOfNonArrayItems = make(["not array", "also not array", "not array at all"]);
        expect(await validate(model)).toHaveLength(0);
      });

      for (const [label, name, validateFn] of [
        ["synchronous logic", "customContainsHelloConstraint", (ok: boolean) => ok],
        ["async logic", "customAsyncContainsHelloConstraint", (ok: boolean) => Promise.resolve(ok)],
        ["mixed (synchronous + async) logic", "customMixedContainsHelloConstraint", (ok: boolean) => (ok ? ok : Promise.resolve(ok))],
      ] as const) {
        it(`should apply validation via custom constraint class with ${label} to each item in the ${kind}`, async () => {
          @ValidatorConstraint({ name, async: label !== "synchronous logic" })
          class ContainsHello implements ValidatorConstraintInterface {
            validate(value: any) {
              return validateFn(!isKind(value) && String(value).includes("hello"));
            }
          }
          class MyClass {
            @Validate(ContainsHello, { each: true })
            someProperty!: unknown;
          }
          const model = new MyClass();
          model.someProperty = make(words);
          const errors = await validate(model);
          expect(errors.length).toEqual(1);
          expect(Object.keys(errors[0]!.constraints!)).toEqual([name]);
          expect(errors[0]!.property).toEqual("someProperty");
        });
      }
    });
  }
});

describe("groups", () => {
  class MyClass {
    @Contains("hello", { groups: ["title-validation"] }) title!: string;
    @Contains("bye", { groups: ["text-validation"] }) text!: string;
  }
  const mk = (title: string, text: string) => Object.assign(new MyClass(), { title, text });
  const validTitle = mk("hello world", "hello world");
  const validText = mk("bye world", "bye world");
  const validBoth = mk("hello world", "bye world");
  const validNone = mk("bye world", "hello world");
  const codes = (e: { constraints?: object }) => Object.keys(e.constraints ?? {});

  // [groups option, [which property errors for validTitle, validText, validBoth, validNone]]
  type Expect = string | null; // property expected to fail, or null for no errors
  const table: [string, string[] | undefined, [Expect, Expect, Expect, Expect]][] = [
    ["only properties of the given group: title-validation", ["title-validation"], [null, "title", null, "title"]],
    ["only properties of the given group: text-validation", ["text-validation"], ["text", null, null, "text"]],
    ["only properties of the given groups: both groups", ["title-validation", "text-validation"], [ "text", "title", null, "title+text" as never ]],
    ["all if no group is given", undefined, ["text", "title", null, "title+text" as never]],
    ["all groups if empty group array is given", [], ["text", "title", null, "title+text" as never]],
  ];
  for (const [name, groups, expected] of table) {
    describe(`should validate ${name}`, () => {
      ["with valid title", "with valid text", "with both valid", "with none valid"].forEach((label, i) => {
        it(label, async () => {
          const model = [validTitle, validText, validBoth, validNone][i]!;
          const errors = await validate(model, { groups });
          const want = expected[i];
          if (want === null) expect(errors).toHaveLength(0);
          else expect(errors.map((e) => e.property)).toEqual(want!.split("+"));
          errors.forEach((e) => expect(codes(e)).toEqual(["contains"]));
        });
      });
    });
  }

  describe("multiple groups per property", () => {
    class Multi {
      @Contains("hello", { groups: ["contains"] })
      @Matches(/.*stranger.*/, { groups: ["matches"] })
      title!: string;
    }
    const mkm = (title: string) => Object.assign(new Multi(), { title });
    const models = [mkm("hello"), mkm("stranger"), mkm("hello stranger"), mkm("howdy rowdy")];
    const cases: [string, string[], (string | null)[]][] = [
      ["group: contains", ["contains"], [null, "contains", null, "contains"]],
      ["group: matches", ["matches"], ["matches", null, null, "matches"]],
      ["groups: contains & matches", ["contains", "matches"], ["matches", "contains", null, "contains+matches"]],
    ];
    for (const [name, groups, expected] of cases) {
      describe(name, () => {
        ["with valid contains", "with valid matches", "with valid both", "with valid none"].forEach((label, i) => {
          it(label, async () => {
            const errors = await validate(models[i]!, { groups });
            const want = expected[i];
            if (want === null) expect(errors).toHaveLength(0);
            else {
              expect(errors).toHaveLength(1);
              expect(Object.keys(errors[0]!.constraints!).sort()).toEqual(want!.split("+").sort());
            }
          });
        });
      });
    }
  });

  describe("ValidationOptions.always", () => {
    class Opts {
      @Contains("noOptions") noOptions!: string;
      @Contains("groupA", { groups: ["A"] }) groupA!: string;
      @Contains("alwaysFalse", { always: false }) alwaysFalse!: string;
      @Contains("alwaysTrue", { always: true }) alwaysTrue!: string;
    }
    const base = { noOptions: "noOptions", groupA: "groupA", alwaysFalse: "alwaysFalse", alwaysTrue: "alwaysTrue" };
    const m = (over: object) => Object.assign(new Opts(), base, over);

    it("should validate decorator without options", async () => {
      expect(await validate(m({ noOptions: "XXX" }), { always: true, groups: ["A"] })).toHaveLength(1);
    });
    it("should not validate decorator with groups if validating without matching groups", async () => {
      expect(await validate(m({ groupA: "XXX" }), { always: true, groups: ["B"] })).toHaveLength(0);
    });
    it("should not validate decorator with always set to false", async () => {
      expect(await validate(m({ alwaysFalse: "XXX" }), { always: true, groups: ["A"] })).toHaveLength(0);
    });
    it("should validate decorator with always set to true", async () => {
      expect(await validate(m({ alwaysTrue: "XXX" }), { always: true, groups: ["A"] })).toHaveLength(1);
    });
  });

  describe("strictGroups", () => {
    class Strict {
      @Contains("hello", { groups: ["A"] }) a!: string;
      @Contains("hello") b!: string;
    }
    const bad = Object.assign(new Strict(), { a: "XXX", b: "hello" });
    it("should ignore decorators with groups if validating without groups", async () => {
      expect(await validate(bad, { strictGroups: true })).toHaveLength(0);
    });
    it("should ignore decorators with groups if validating with empty groups array", async () => {
      expect(await validate(bad, { strictGroups: true, groups: [] })).toHaveLength(0);
    });
    it("should include decorators with groups if validating with matching groups", async () => {
      expect(await validate(bad, { strictGroups: true, groups: ["A"] })).toHaveLength(1);
    });
    it("should not include decorators with groups if validating with different groups", async () => {
      expect(await validate(bad, { strictGroups: true, groups: ["B"] })).toHaveLength(0);
    });
  });

  describe("always", () => {
    class Al {
      @Contains("hello", { groups: ["a"] }) a!: string;
      @Contains("hello", { groups: ["b"], always: true }) b!: string;
    }
    const m = Object.assign(new Al(), { a: "XXX", b: "XXX" });
    it("should always validate a marked field even if another group is specified", async () => {
      expect((await validate(m, { groups: ["a"] })).map((e) => e.property).sort()).toEqual(["a", "b"]);
      expect((await validate(m, { groups: ["other"] })).map((e) => e.property)).toEqual(["b"]);
    });
    it("should always validate a marked field if its group is specified also (doubly enabled)", async () => {
      expect((await validate(m, { groups: ["b"] })).map((e) => e.property)).toEqual(["b"]);
    });
    it("should always validate *all* fields if group is not specified", async () => {
      expect(await validate(m)).toHaveLength(2);
    });
    it("should always validate *all* fields if groups array is empty", async () => {
      expect(await validate(m, { groups: [] })).toHaveLength(2);
    });
  });

  describe("groups - nested", () => {
    class Child {
      @Contains("hello", { groups: ["always"], always: true }) text!: string;
    }
    class Root {
      @Nested(() => Child, { groups: ["always"], always: true }) always = { text: "bye" };
      @Nested(() => Child, { groups: ["sometimes"] }) sometimes = { text: "bye" };
      @Nested(() => Child, { groups: ["other"] }) other = { text: "bye" };
    }
    const model = new Root();
    const check = (errors: Awaited<ReturnType<typeof validate>>, names: string[]) => {
      expect(errors.map((e) => e.property)).toEqual(names);
      errors.forEach((e) => {
        expect(e.children).toHaveLength(1);
        expect(e.children[0]!.property).toEqual("text");
        expect(Object.keys(e.children[0]!.constraints!)).toEqual(["contains"]);
      });
    };
    it("should validate all children if no group is given", async () => {
      check(await validate(model, { groups: undefined }), ["always", "sometimes", "other"]);
    });
    it("should validate only the given group + always", async () => {
      check(await validate(model, { groups: ["sometimes"] }), ["always", "sometimes"]);
    });
    it("should validate only the given group + always (always only)", async () => {
      check(await validate(model, { groups: ["always"] }), ["always"]);
    });
  });
});

describe("context", () => {
  it("should map context", async () => {
    class MyClass {
      @Contains("hello", { message: "String is not valid. You string must contain a hello word", context: { hi: "there" } })
      someProperty!: string;
      @Contains("bye", { message: "String is not valid. You string must contain a bye word", context: { bye: "now" } })
      someOtherProperty!: string;
    }
    const model = Object.assign(new MyClass(), { someProperty: "x", someOtherProperty: "y" });
    const errors = await validate(model);
    expect(errors.length).toEqual(2); // (original also has a registerDecorator-based IsLongerThan: see todo below)
    expect(errors[0]!.contexts!["contains"]).toEqual({ hi: "there" });
    expect(errors[1]!.contexts!["contains"]).toEqual({ bye: "now" });
  });
  it("should map context from a custom registerDecorator() rule", async () => {
    function IsLongerThan(property: string, validationOptions?: ValidationOptions) {
      return function (_value: undefined, context: ClassFieldDecoratorContext): void {
        registerDecorator({
          context,
          options: validationOptions,
          constraints: [property],
          name: "isLongerThan",
          validator: {
            validate(value: any, args: ValidationArguments): boolean {
              const related = (args.object as any)[(args.constraints as [string])[0]];
              if (related === undefined || related === null) return true;
              return typeof value === "string" && typeof related === "string" && value.length > related.length;
            },
          },
        });
      };
    }
    class MyClass {
      @Contains("hello", { context: { hi: "there" } }) someProperty!: string;
      @IsLongerThan("lastName", { context: { baz: "qux" }, message: "$property must be longer then $constraint1. Given value: $value" })
      firstName!: string;
      lastName?: string;
    }
    const model = Object.assign(new MyClass(), { someProperty: "x", firstName: "Short", lastName: "LongerThanFirstName" });
    const errors = await validate(model);
    expect(errors.length).toEqual(2);
    expect(errors[1]!.contexts!["isLongerThan"]).toEqual({ baz: "qux" });
    expect(errors[1]!.constraints!["isLongerThan"]).toEqual("firstName must be longer then lastName. Given value: Short");
  });
  it("IsDefined options (message, context) apply to a missing property", async () => {
    class MyClass {
      @IsDefined({ context: { foo: "bar" }, message: "$property is missing" }) requiredProperty!: string;
    }
    const errors = await validate(new MyClass());
    expect(errors.length).toEqual(1);
    expect(errors[0]!.contexts!["isDefined"]).toEqual({ foo: "bar" });
    expect(errors[0]!.constraints!["isDefined"]).toEqual("requiredProperty is missing");
  });

  it("should map multiple context on a single property for different constraints", async () => {
    class MyClass {
      @Contains("hello", { message: "String is not valid. You string must contain a hello word", context: { hi: "there" } })
      @MinLength(20, { context: { whats: "up" } })
      someProperty!: string;
    }
    const errors = await validate(Object.assign(new MyClass(), { someProperty: "bippity" }));
    expect(errors.length).toEqual(1);
    expect(errors[0]!.contexts!["contains"]).toEqual({ hi: "there" });
    expect(errors[0]!.contexts!["minLength"]).toEqual({ whats: "up" });
  });

  it("should not map no context", async () => {
    class MyClass {
      @Contains("hello", { message: "String is not valid. You string must contain a hello word" }) someProperty!: string;
      @Contains("bye", { message: "String is not valid. You string must contain a bye word", context: { bye: "now" } })
      someOtherProperty!: string;
    }
    const errors = await validate(Object.assign(new MyClass(), { someProperty: "x", someOtherProperty: "y" }));
    expect(errors.length).toEqual(2);
    expect(errors[0]!.contexts).toBeUndefined();
    expect(errors[1]!.contexts!["contains"]).toEqual({ bye: "now" });
  });

  it("should stop at first error.", async () => {
    class MyClass {
      @MinLength(20, { message: "minLength" })
      @Contains("hello", { message: "String is not valid. You string must contain a hello word" })
      sameProperty!: string;
      @IsArray() nestedWithPrimitiveValue!: unknown;
    }
    const model = Object.assign(new MyClass(), { sameProperty: "bye", nestedWithPrimitiveValue: "invalid" });
    const stop = await validate(model, { stopAtFirstError: true });
    expect(stop.map((e) => Object.keys(e.constraints!).length)).toEqual([1, 1]);
    expect(Object.keys(stop[1]!.constraints!)).toEqual(["isArray"]);
    const all = await validate(model, { stopAtFirstError: false });
    expect(all.map((e) => Object.keys(e.constraints!).sort())).toEqual([["contains", "minLength"], ["isArray"]]);
  });
});

describe("validateIf", () => {
  class MyClass {
    @Min(5, { message: "min", validateIf: (obj: any) => !obj.someOtherProperty || obj.someOtherProperty === "min" })
    @Max(3, { message: "max", validateIf: (o: any) => !o.someOtherProperty || o.someOtherProperty === "max" })
    someProperty!: number;
    someOtherProperty?: string;
  }
  const mk = (other?: string) => Object.assign(new MyClass(), { someProperty: 4, someOtherProperty: other });

  it.todo("should be true: isValidationOptions() helper (class-validator internal utility, not part of dto-kit's public API)");
  it("should only validate min", async () => {
    const errors = await validate(mk("min"));
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ min: "min" });
  });
  it("should only validate max", async () => {
    const errors = await validate(mk("max"));
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ max: "max" });
  });
  it("should validate both", async () => {
    const errors = await validate(mk());
    expect(errors.length).toEqual(1);
    expect(errors[0]!.constraints).toEqual({ min: "min", max: "max" });
  });
  it("should validate none", async () => {
    expect(await validate(mk("other"))).toHaveLength(0);
  });
});

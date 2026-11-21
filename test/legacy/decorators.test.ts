// @ts-nocheck -- compiled with experimentalDecorators (as in a NestJS project), where decorators receive
// (target, propertyKey, descriptor) instead of (value, context). Everything must behave exactly like standard mode.
import { describe, expect, it } from "vitest";
import {
  Contains, Each, Exclude, Expose, IsEmail, IsInt, IsString, Min, MinLength, Nested, Optional, Transform, Type, Validate,
  ValidatorConstraint, ValidateNested, TransformInstanceToPlain, instanceToPlain, parse, parseAsync, plainToInstance, registerDecorator,
} from "../../src/index.js";

class Address {
  @IsString() @MinLength(2) city: string;
}
class Base {
  @IsString() id: string;
}
class User extends Base {
  @IsEmail() email: string;
  @IsInt() @Min(18) @Type(() => Number) age: number;
  @Optional() @IsString() bio?: string;
  @Expose({ name: "user_name" }) @IsString() username: string;
  @Exclude({ toPlainOnly: true }) password: string;
  @Nested(() => Address, { each: true }) addresses: Address[];
  @Transform(({ value }) => String(value).trim().toLowerCase()) @IsString() tag: string;
  @Expose() get label() {
    return `#${this.id}`;
  }
}

const good = { id: "1", email: "a@b.co", age: "30", user_name: "ada", password: "pw", addresses: [{ city: "Rome" }], tag: "  X " };

describe("legacy (experimentalDecorators) mode", () => {
  it("validates, coerces, renames, transforms and nests", () => {
    const r = parse(User, good);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.age).toBe(30);
      expect(r.value.username).toBe("ada");
      expect(r.value.tag).toBe("x");
      expect(r.value.addresses[0]).toBeInstanceOf(Address);
    }
  });

  it("reports issues with paths and codes", () => {
    const r = parse(User, { ...good, email: "nope", age: 5, addresses: [{ city: "R" }] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.map((i) => `${i.path.join(".")}:${i.code}`)).toEqual(["email:isEmail", "age:min", "addresses.0.city:minLength"]);
  });

  it("inherits parent rules without leaking into the parent", () => {
    expect(parse(User, { ...good, id: undefined }).success).toBe(false);
    expect(parse(Base, { id: "x" }).success).toBe(true);
  });

  it("class-transformer API: Expose names, Exclude toPlainOnly, getters", () => {
    const u = plainToInstance(User, good);
    expect(u.username).toBe("ada");
    const out = instanceToPlain(u);
    expect(out.user_name).toBe("ada");
    expect(out.password).toBeUndefined();
    expect(out.label).toBe("#1");
  });

  it("class decorators (@Exclude / @Expose on the class)", () => {
    @Exclude()
    class Strict {
      @Expose() a: number;
      b: number;
    }
    expect(instanceToPlain(Object.assign(new Strict(), { a: 1, b: 2 }))).toEqual({ a: 1 });
  });

  it("method decorators wrap the descriptor", async () => {
    class Svc {
      @TransformInstanceToPlain()
      one() {
        return plainToInstance(User, good);
      }
      @TransformInstanceToPlain()
      async two() {
        return plainToInstance(User, good);
      }
    }
    expect(new Svc().one().user_name).toBe("ada");
    expect((await new Svc().two()).user_name).toBe("ada");
  });

  it("per-rule options (each, groups, message tokens) work", () => {
    class T {
      @Contains("a", { each: true, message: "$property bad: $constraint1" }) xs: string[];
    }
    const r = parse(T, { xs: ["a", "b"] });
    expect(!r.success && r.issues[0]?.message).toBe("xs bad: a");
  });

  it("registerDecorator with legacy target + propertyName (class-validator style) and async constraints", async () => {
    function IsLonger(prop: string) {
      return (object: object, propertyName: string) =>
        registerDecorator({
          target: object.constructor,
          propertyName,
          constraints: [prop],
          name: "isLonger",
          validator: { validate: (v, a) => String(v).length > String(a.object[a.constraints[0]]).length },
        });
    }
    @ValidatorConstraint({ name: "isFree" })
    class IsFree {
      validate(v) {
        return Promise.resolve(v !== "taken");
      }
    }
    class Form {
      @IsLonger("last") first: string;
      @Validate(IsFree) handle: string;
      last: string;
    }
    expect((await parseAsync(Form, { first: "Paul", last: "Walker", handle: "ok" })).success).toBe(false);
    expect((await parseAsync(Form, { first: "Walker!", last: "Paul", handle: "ok" })).success).toBe(true);
    const r = await parseAsync(Form, { first: "Walker!", last: "Paul", handle: "taken" });
    expect(!r.success && r.issues[0]?.code).toBe("isFree");
  });

  it("ValidateNested() without a type uses the value's own class", () => {
    class Box {
      @ValidateNested() inner: Address;
    }
    const inner = Object.assign(new Address(), { city: "R" });
    expect(parse(Box, { inner }).success).toBe(false);
  });
});

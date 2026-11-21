import { describe, expect, it } from "vitest";
import {
  Exclude, Expose, IsEmail, IsInt, IsString, Length, Min, Nested, Optional,
  parse, parseOrThrow, schema, instanceToPlain,
} from "../src/index.js";

class Address {
  @IsString() @Length(2) city!: string;
}

class User {
  @IsEmail() email!: string;
  @IsString() @Length(3, 20) @Expose({ name: "user_name" }) username!: string;
  @IsInt() @Min(18) age!: number;
  @Optional() @IsString() bio?: string;
  @IsString() @Exclude() password!: string;
  @Nested(() => Address, { each: true }) addresses!: Address[];
}

class Admin extends User {
  @IsString() role!: string;
}

const good = { email: "a@b.co", user_name: "alice", age: 30, password: "x", addresses: [{ city: "Rome" }] };

describe("dto-kit", () => {
  it("parses valid input into a class instance", () => {
    const r = parse(User, good);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value).toBeInstanceOf(User);
      expect(r.value.username).toBe("alice");
      expect(r.value.addresses[0]).toBeInstanceOf(Address);
    }
  });

  it("reports issues with paths", () => {
    const r = parse(User, { ...good, email: "nope", age: 5, addresses: [{ city: "R" }] });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.issues.map((i) => i.path.join("."))).toEqual(["email", "age", "addresses.0.city"]);
    }
  });

  it("requires non-optional fields, allows optional ones", () => {
    const { age: _a, ...missing } = good;
    expect(parse(User, missing).success).toBe(false);
    expect(parse(User, good).success).toBe(true);
  });

  it("serialize honors @Expose and @Exclude", () => {
    const u = parseOrThrow(User, good);
    expect(instanceToPlain(u)).toEqual({
      email: "a@b.co", user_name: "alice", age: 30, addresses: [{ city: "Rome" }],
    });
  });

  it("strict mode flags unknown keys", () => {
    const r = parse(User, { ...good, extra: 1 }, { strict: true });
    expect(r.success).toBe(false);
  });

  it("inherits parent fields without mutating the parent", () => {
    expect(parse(Admin, good).success).toBe(false); // role missing
    expect(parse(Admin, { ...good, role: "root" }).success).toBe(true);
    expect(parse(User, good).success).toBe(true); // parent unaffected
  });

  it("implements Standard Schema", () => {
    const s = schema(User)["~standard"];
    expect(s.vendor).toBe("dto-kit");
    expect("value" in s.validate(good)).toBe(true);
    expect("issues" in s.validate({})).toBe(true);
  });
});

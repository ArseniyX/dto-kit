import { describe, expect, it } from "vitest";
import {
  ArrayMinSize, Each, IsDate, IsEnum, IsInt, IsNumber, IsString, IsUUID, IsURL, IsISO8601,
  IsIP, IsMobilePhone, IsStrongPassword, Contains, NotContains, Min, Optional,
  Transform, Type, ValidateIf, IsBoolean, parse,
} from "../src/index.js";

enum Role { Admin = "admin", User = "user" }

class Query {
  @Type(() => Number) @IsInt() @Min(1) page!: number;
  @Type(() => Boolean) @IsBoolean() active!: boolean;
  @Type(() => Date) @IsDate() since!: Date;
  @Optional() @IsEnum(Role) role?: Role;
}

class Tags {
  @Each() @IsString() tags!: string[];
  @Each() @Type(() => Number) @IsNumber() scores!: number[];
  @Optional() @Each() @ArrayMinSize(0) opt?: string[];
}

class Cond {
  @IsString() kind!: string;
  @ValidateIf((o) => o.kind === "email") @IsString() @Contains("@") address!: string;
}

class Trim {
  @Transform(({ value: v }) => (typeof v === "string" ? v.trim().toLowerCase() : v)) @IsString() name!: string;
}

class Strings {
  @IsUUID() id!: string;
  @IsUUID("4") id4!: string;
  @IsURL() url!: string;
  @IsISO8601() when!: string;
  @IsIP("4") ip!: string;
  @IsMobilePhone("en-US") phone!: string;
  @IsStrongPassword() pw!: string;
  @NotContains("admin") handle!: string;
}

describe("@Type coercion", () => {
  it("coerces query-string style input", () => {
    const r = parse(Query, { page: "3", active: "true", since: "2026-01-02" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.page).toBe(3);
      expect(r.value.active).toBe(true);
      expect(r.value.since).toBeInstanceOf(Date);
    }
  });
  it("fails validation when coercion cannot produce a valid value", () => {
    const r = parse(Query, { page: "abc", active: "maybe", since: "not-a-date" });
    expect(r.success).toBe(false);
    // every failing rule is reported (page fails IsInt and Min), so compare the distinct fields
    if (!r.success) expect([...new Set(r.issues.map((i) => i.path[0]))]).toEqual(["page", "active", "since"]);
  });
  it("validates enums", () => {
    expect(parse(Query, { page: 1, active: true, since: "2026-01-01", role: "admin" }).success).toBe(true);
    expect(parse(Query, { page: 1, active: true, since: "2026-01-01", role: "root" }).success).toBe(false);
  });
});

describe("@Each", () => {
  it("applies rules/coercion per element with indexed paths", () => {
    const ok = parse(Tags, { tags: ["a", "b"], scores: ["1", 2] });
    expect(ok.success && ok.value.scores).toEqual([1, 2]);
    const bad = parse(Tags, { tags: ["a", 5], scores: ["x"] });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.issues.map((i) => i.path.join("."))).toEqual(["tags.1", "scores.0"]);
  });
  it("rejects non-arrays", () => {
    expect(parse(Tags, { tags: "a", scores: [] }).success).toBe(false);
  });
});

describe("@ValidateIf / @Transform", () => {
  it("skips the field when the condition is false", () => {
    expect(parse(Cond, { kind: "none" }).success).toBe(true);
    expect(parse(Cond, { kind: "email" }).success).toBe(false);
    expect(parse(Cond, { kind: "email", address: "a@b.co" }).success).toBe(true);
  });
  it("runs custom transforms before rules", () => {
    const r = parse(Trim, { name: "  Alice " });
    expect(r.success && r.value.name).toBe("alice");
  });
});

describe("validator.js rules", () => {
  const good = {
    id: "550e8400-e29b-41d4-a716-446655440000", id4: "550e8400-e29b-41d4-a716-446655440000",
    url: "https://example.com", when: "2026-01-01T10:00:00Z", ip: "10.0.0.1",
    phone: "+14155552671", pw: "Str0ng!Passw0rd", handle: "bob",
  };
  it("accepts valid values", () => expect(parse(Strings, good).success).toBe(true));
  it("rejects invalid values per field", () => {
    const r = parse(Strings, {
      id: "x", id4: "550e8400-e29b-11d4-a716-446655440000", url: "nope", when: "yesterday",
      ip: "::1", phone: "123", pw: "weak", handle: "administrator",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.map((i) => i.path[0])).toEqual(["id", "id4", "url", "when", "ip", "phone", "pw", "handle"]);
  });
});

import { Validate, ValidatorConstraint, parseAsync, type ValidatorConstraintInterface } from "../src/index.js";

describe("async rules", () => {
  @ValidatorConstraint({ name: "isFree" })
  class IsFree implements ValidatorConstraintInterface {
    validate(v: unknown) {
      return Promise.resolve(v !== "taken");
    }
  }
  class Signup {
    @IsString() @Validate(IsFree) handle!: string;
  }

  it("parseAsync awaits async constraints", async () => {
    expect((await parseAsync(Signup, { handle: "free" })).success).toBe(true);
    const r = await parseAsync(Signup, { handle: "taken" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues[0]?.code).toBe("isFree");
  });
  it("sync parse refuses async rules instead of silently passing", () => {
    expect(() => parse(Signup, { handle: "free" })).toThrow(/parseAsync/);
  });
});

import { Expose, Nested as NestedDec } from "../src/index.js";

describe("nested types: containers and classes without rules", () => {
  class Weapon {
    @Expose() model!: string;
  }
  class Armoury {
    @Type(() => Weapon, { container: Map }) byName!: Map<string, Weapon>;
    @Type(() => Weapon, { container: Set }) unique!: Set<Weapon>;
  }
  class Checked {
    @IsString() @IsUUID() id!: string;
  }
  class Registry {
    @NestedDec(() => Checked, { each: false }) @Type(() => Checked, { container: Map }) byKey!: Map<string, Checked>;
  }

  it("parse() rebuilds a Map / Set from plain objects / arrays, building rule-less classes instead of throwing", () => {
    const r = parse(Armoury, { byName: { knife: { model: "K" } }, unique: [{ model: "A" }] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.byName).toBeInstanceOf(Map);
      expect(r.value.byName.get("knife")).toBeInstanceOf(Weapon);
      expect(r.value.unique).toBeInstanceOf(Set);
      expect([...r.value.unique][0]).toBeInstanceOf(Weapon);
    }
  });

  it("validates the values of a Map container, with the Map key in the issue path", () => {
    const r = parse(Registry, { byKey: { good: { id: "550e8400-e29b-41d4-a716-446655440000" }, bad: { id: "x" } } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.map((i) => i.path.join("."))).toEqual(["byKey.bad.id"]);
  });
});

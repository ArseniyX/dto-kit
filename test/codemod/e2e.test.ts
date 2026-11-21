// Migrate a realistic class-validator + class-transformer DTO file with the codemod, then run the *migrated* file.
import { beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transformSource } from "../../src/codemod/index.js";

const ORIGINAL = `import 'reflect-metadata';
import { IsString, IsEmail, IsUrl, IsOptional, IsInt, Min, ValidateNested, IsNumberString, IsDateString } from 'class-validator';
import { Type, Expose, Exclude, Transform, plainToInstance, instanceToPlain } from 'class-transformer';

export class Address {
  @IsString() city: string;
}
export class Weapon {
  @Expose() model: string;
}

export class CreateUserDto {
  @IsEmail() email: string;
  @IsOptional() @IsUrl() website?: string;
  @Type(() => Number) @IsInt() @Min(18) age: number;
  @IsNumberString() zip: string;
  @IsDateString() born: string;
  @Expose({ name: 'user_name' }) @IsString() username: string;
  @Exclude({ toPlainOnly: true }) @IsString() password: string;
  @ValidateNested({ each: true }) @Type(() => Address) addresses: Address[];
  @Transform(({ value }) => String(value).trim().toLowerCase()) @IsString() tag: string;
  @Type(() => Weapon)
  weapons: Map<string, Weapon>;
}

export const toInstance = (plain: object) => plainToInstance(CreateUserDto, plain);
export const toPlain = (i: CreateUserDto) => instanceToPlain(i);
`;

const good = {
  email: "ada@example.com", website: "https://example.com", age: "30", zip: "12345", born: "1990-01-02",
  user_name: "ada", password: "pw", addresses: [{ city: "Rome" }], tag: "  X ", weapons: { knife: { model: "K" } },
};

describe("codemod end to end", () => {
  const result = transformSource(ORIGINAL);
  let mod: any;

  beforeAll(async () => {
    const dir = join(process.cwd(), "test/codemod/.generated");
    mkdirSync(dir, { recursive: true });
    // (class-validator style code has uninitialised fields; this is the migrated source as-is, only exempted from strict checks)
    writeFileSync(join(dir, "user.dto.ts"), "// @ts-nocheck\n" + result.code);
    // @ts-ignore -- written by the line above, so it does not exist when the project is type-checked
    mod = await import("./.generated/user.dto.ts");
  });

  it("rewrites imports, renames, and adds the Map container", () => {
    expect(result.code).not.toMatch(/class-validator|class-transformer/);
    expect(result.code).toContain("from 'dto-kit'");
    expect(result.code).toContain("@IsURL()");
    expect(result.code).toContain("@IsNumericString()");
    expect(result.code).toContain("@IsISO8601()");
    expect(result.code).toContain("@Type(() => Weapon, { container: Map })");
    expect(result.warnings).toEqual([]);
  });

  it("the migrated DTO validates plain input with dto-kit's parse()", async () => {
    const { parse } = await import("dto-kit");
    // (weapons has no validation rules; it is a transformer concern)
    const r: any = parse(mod.CreateUserDto, good);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.value.age).toBe(30);
      expect(r.value.username).toBe("ada");
      expect(r.value.tag).toBe("x");
      expect(r.value.addresses[0]).toBeInstanceOf(mod.Address);
    }
  });

  it("and rejects bad input with the renamed rules' codes", async () => {
    const { parse } = await import("dto-kit");
    const r = parse(mod.CreateUserDto, { ...good, website: "nope", zip: "12ab", born: "yesterday", age: 5 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.issues.map((i: any) => i.code).sort()).toEqual(["isISO8601", "isNumeric", "isURL", "min"].sort());
  });

  it("class-transformer calls in the migrated file behave: Expose names, Map container, Exclude toPlainOnly", () => {
    const u = mod.toInstance(good);
    expect(u).toBeInstanceOf(mod.CreateUserDto);
    expect(u.username).toBe("ada");
    expect(u.weapons).toBeInstanceOf(Map);
    expect(u.weapons.get("knife")).toBeInstanceOf(mod.Weapon);
    const plain = mod.toPlain(u);
    expect(plain.user_name).toBe("ada");
    expect(plain.password).toBeUndefined();
    expect(plain.weapons).toEqual({ knife: { model: "K" } });
  });
});

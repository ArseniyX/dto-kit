import { describe, expect, it } from "vitest";
import {
  Exclude, Expose, IsEmail, IsString, Transform, TransformationType, Type, ClassTransformer,
  TransformInstanceToPlain, classToPlain, deserialize, instanceToInstance, instanceToPlain, parse, plainToInstance, serialize,
} from "../src/index.js";

class Weapon {
  @Expose() model!: string;
  @Expose() range!: number;
}

class User {
  @Expose({ name: "user_id" }) id!: number;
  @IsString() @Expose() name!: string;
  @IsEmail() email!: string;
  @Exclude({ toPlainOnly: true }) password!: string;
  @Type(() => Date) joined!: Date;
  @Type(() => Weapon, { container: Map }) weapons!: Map<string, Weapon>;
  @Type(() => Weapon) favourite!: Weapon;
  @Transform(({ value }) => String(value).toUpperCase(), { toClassOnly: true }) code!: string;
  @Expose({ groups: ["admin"] }) secret?: string;
  @Expose() get label(): string {
    return `#${this.id}`;
  }
}

const plain = {
  user_id: 7, name: "Ada", email: "ada@example.com", password: "pw", joined: "2026-01-02T00:00:00Z", code: "ab",
  weapons: { knife: { model: "K", range: 1 } }, favourite: { model: "F", range: 2 }, secret: "s",
};

describe("class-transformer compatible API (typed)", () => {
  it("plainToInstance builds instances, honours Expose names, Type, container and toClassOnly Transform", () => {
    const u = plainToInstance(User, plain);
    expect(u).toBeInstanceOf(User);
    expect(u.id).toBe(7);
    expect(u.joined).toBeInstanceOf(Date);
    expect(u.weapons).toBeInstanceOf(Map);
    expect(u.weapons.get("knife")).toBeInstanceOf(Weapon);
    expect(u.favourite).toBeInstanceOf(Weapon);
    expect(u.code).toBe("AB");
    expect(u.secret).toBeUndefined(); // group "admin" not requested
  });

  it("instanceToPlain renames, excludes toPlainOnly, exposes getters, serialises Maps and Dates", () => {
    const u = plainToInstance(User, plain, { groups: ["admin"] });
    expect(u.secret).toBe("s");
    const out = instanceToPlain(u, { groups: ["admin"] });
    expect(out["user_id"]).toBe(7);
    expect(out["password"]).toBeUndefined();
    expect(out["label"]).toBe("#7");
    expect(out["weapons"]).toEqual({ knife: { model: "K", range: 1 } });
    expect(out["secret"]).toBe("s");
  });

  it("round-trips through JSON with serialize / deserialize", () => {
    const u = plainToInstance(User, plain);
    const back = deserialize(User, serialize(u));
    expect(back.id).toBe(7);
    expect(back.weapons.get("knife")?.model).toBe("K");
  });

  it("instanceToInstance clones", () => {
    const u = plainToInstance(User, plain);
    const c = instanceToInstance(u);
    expect(c).not.toBe(u);
    expect(c).toBeInstanceOf(User);
    expect(c.favourite).not.toBe(u.favourite);
  });

  it("arrays, strategy and old names", () => {
    const list = plainToInstance(Weapon, [{ model: "a", range: 1 }, { model: "b", range: 2 }]);
    expect(list).toHaveLength(2);
    expect(list[0]).toBeInstanceOf(Weapon);
    expect(classToPlain(list[0]!, { strategy: "excludeAll" })).toEqual({ model: "a", range: 1 }); // @Expose'd fields only
    expect(new ClassTransformer().instanceToPlain(list[1]!)).toEqual({ model: "b", range: 2 });
  });

  it("the Transform callback gets value, key, obj, type and options", () => {
    const seen: unknown[] = [];
    class T {
      @Transform((p) => {
        seen.push([p.value, p.key, p.obj, p.type, p.options.groups]);
        return p.value;
      })
      x!: number;
    }
    plainToInstance(T, { x: 1 }, { groups: ["g"] });
    expect(seen).toEqual([[1, "x", { x: 1 }, TransformationType.PLAIN_TO_CLASS, ["g"]]]);
  });

  it("method decorators transform the return value (sync)", () => {
    class Service {
      @TransformInstanceToPlain()
      find(): User {
        return plainToInstance(User, plain);
      }
    }
    // (decorators can't change a method's declared return type, so the plain result needs a cast)
    expect((new Service().find() as unknown as Record<string, unknown>)["user_id"]).toBe(7);
  });

  it("the same decorators drive validation: parse() reads the exposed name and runs the Transform", () => {
    class Signup {
      @Expose({ name: "user_name" }) @IsString() username!: string;
      @Transform(({ value }) => String(value).trim().toLowerCase()) @IsEmail() email!: string;
    }
    const ok = parse(Signup, { user_name: "ada", email: "  ADA@Example.com " });
    expect(ok.success && ok.value.email).toBe("ada@example.com");
    expect(parse(Signup, { username: "ada", email: "ada@example.com" }).success).toBe(false); // wrong key
  });

  it("Transform decorators apply top decorator first (as in class-transformer)", () => {
    class Order {
      @Transform(({ value }) => `${value}A`)
      @Transform(({ value }) => `${value}B`)
      x!: string;
    }
    expect(plainToInstance(Order, { x: "" }).x).toBe("AB");
  });
});

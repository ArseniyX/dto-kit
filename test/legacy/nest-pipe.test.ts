// @ts-nocheck -- compiled with experimentalDecorators, like a NestJS project
import "reflect-metadata";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException, Body, Controller, Get, HttpException, Param, Post, Query, StandardSchemaValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import {
  Contains, Exclude, Expose, IsEmail, IsInt, IsString, Min, MinLength, Nested, Optional, Type, Validate, ValidatorConstraint, schema,
} from "../../src/index.js";
import { DtoKitValidationPipe, formatIssueMessage } from "../../src/nest.js";

class AddressDto {
  @IsString() @MinLength(2) city: string;
}
class CreateUserDto {
  @IsEmail() email: string;
  @Type(() => Number) @IsInt() @Min(18) age: number;
  @Optional() @IsString() bio?: string;
  @Nested(() => AddressDto, { each: true }) addresses: AddressDto[];
  @Exclude({ toPlainOnly: true }) @IsString() password: string;
}
const good = { email: "a@b.co", age: "30", addresses: [{ city: "Rome" }], password: "pw" };
const meta = (metatype, type = "body", data?) => ({ type, metatype, data });

async function rejection(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the pipe to reject");
}

describe("DtoKitValidationPipe", () => {
  it("passes valid input through unchanged by default (Nest's transform: false)", async () => {
    const pipe = new DtoKitValidationPipe();
    const input = { ...good, extra: 1 };
    expect(await pipe.transform(input, meta(CreateUserDto))).toBe(input);
  });

  it("transform: true returns a DTO instance with coercion and nested instances", async () => {
    const out = await new DtoKitValidationPipe({ transform: true }).transform(good, meta(CreateUserDto));
    expect(out).toBeInstanceOf(CreateUserDto);
    expect(out.age).toBe(30);
    expect(out.addresses[0]).toBeInstanceOf(AddressDto);
  });

  it("rejects with a 400 and Nest's { statusCode, message[], error } shape", async () => {
    const e = await rejection(new DtoKitValidationPipe().transform({ ...good, email: "no", age: 5, addresses: [{ city: "R" }] }, meta(CreateUserDto)));
    expect(e).toBeInstanceOf(BadRequestException);
    expect(e.getStatus()).toBe(400);
    expect(e.getResponse()).toEqual({
      statusCode: 400,
      error: "Bad Request",
      message: ["email must be an email", "age must not be less than 18", "addresses.0.city must be at least 2 characters"],
    });
  });

  it("names missing required properties", async () => {
    const e = await rejection(new DtoKitValidationPipe().transform({}, meta(CreateUserDto)));
    expect(e.getResponse().message).toContain("email is required");
  });

  it("a missing body (undefined/null) is validated as an empty object", async () => {
    const e = await rejection(new DtoKitValidationPipe().transform(undefined, meta(CreateUserDto)));
    expect(e.getResponse().message).toContain("email is required");
  });

  it("whitelist strips unknown properties; forbidNonWhitelisted rejects them", async () => {
    const stripped = await new DtoKitValidationPipe({ whitelist: true }).transform({ ...good, extra: 1 }, meta(CreateUserDto));
    expect(stripped.extra).toBeUndefined();
    expect(stripped.password).toBeUndefined(); // @Exclude({ toPlainOnly }) applies when converting back to plain
    const e = await rejection(new DtoKitValidationPipe({ forbidNonWhitelisted: true }).transform({ ...good, extra: 1 }, meta(CreateUserDto)));
    expect(e.getResponse().message).toEqual(["property extra should not exist"]);
  });

  it("errorHttpStatusCode, disableErrorMessages and exceptionFactory", async () => {
    const e1 = await rejection(new DtoKitValidationPipe({ errorHttpStatusCode: 422 }).transform({}, meta(CreateUserDto)));
    expect(e1).toBeInstanceOf(HttpException);
    expect(e1.getStatus()).toBe(422);
    const e2 = await rejection(new DtoKitValidationPipe({ disableErrorMessages: true }).transform({}, meta(CreateUserDto)));
    expect(e2.getResponse()).toEqual({ statusCode: 400, message: "Bad Request" }); // same body as Nest's own pipe
    const e3 = await rejection(new DtoKitValidationPipe({ exceptionFactory: (issues) => new Error(`custom:${issues.length}`) }).transform({}, meta(CreateUserDto)));
    expect(e3.message).toMatch(/^custom:\d+$/);
  });

  it("groups, stopAtFirstError and skipMissingProperties are forwarded", async () => {
    class G {
      @Contains("a", { groups: ["x"] }) one: string;
      @Contains("b", { groups: ["y"] }) two: string;
    }
    const out = await new DtoKitValidationPipe({ groups: ["x"] }).transform({ one: "a", two: "zzz" }, meta(G));
    expect(out.two).toBe("zzz");
    const e = await rejection(new DtoKitValidationPipe({ stopAtFirstError: true }).transform({ email: 1, age: "x" }, meta(CreateUserDto)));
    expect(e.getResponse().message.length).toBeGreaterThan(0);
    expect(await new DtoKitValidationPipe({ skipMissingProperties: true }).transform({}, meta(CreateUserDto))).toEqual({});
  });

  it("async constraints work (the pipe awaits them)", async () => {
    @ValidatorConstraint({ name: "isFree" })
    class IsFree {
      validate(v) {
        return new Promise((r) => setTimeout(() => r(v !== "taken"), 1));
      }
    }
    class Signup {
      @IsString() @Validate(IsFree) handle: string;
    }
    const pipe = new DtoKitValidationPipe();
    expect(await pipe.transform({ handle: "free" }, meta(Signup))).toEqual({ handle: "free" });
    const e = await rejection(pipe.transform({ handle: "taken" }, meta(Signup)));
    expect(e.getResponse().message).toEqual(["isFree failed"]);
  });

  it("does not touch primitives, custom decorators or untyped parameters", async () => {
    const pipe = new DtoKitValidationPipe();
    expect(await pipe.transform("5", meta(Number, "param", "id"))).toBe("5");
    expect(await pipe.transform({ a: 1 }, meta(Object))).toEqual({ a: 1 });
    expect(await pipe.transform({ a: 1 }, meta(undefined))).toEqual({ a: 1 });
    expect(await pipe.transform({}, meta(CreateUserDto, "custom"))).toEqual({}); // not validated unless validateCustomDecorators
    await rejection(new DtoKitValidationPipe({ validateCustomDecorators: true }).transform({}, meta(CreateUserDto, "custom")));
  });

  it("transform: true converts @Param/@Query primitives like Nest does", async () => {
    const pipe = new DtoKitValidationPipe({ transform: true });
    expect(await pipe.transform("5", meta(Number, "param", "id"))).toBe(5);
    expect(await pipe.transform("true", meta(Boolean, "query", "flag"))).toBe(true);
    expect(await pipe.transform(5, meta(String, "param", "id"))).toBe("5");
  });

  it("expectedType validates against that class", async () => {
    const pipe = new DtoKitValidationPipe({ expectedType: AddressDto });
    await rejection(pipe.transform({ city: "R" }, meta(Object)));
    expect(await pipe.transform({ city: "Rome" }, meta(Object))).toEqual({ city: "Rome" });
  });

  it("a class without dto-kit decorators is not validated (and does not 500)", async () => {
    class Plain {
      name: string;
    }
    expect(await new DtoKitValidationPipe().transform({ a: 1 }, meta(Plain))).toEqual({ a: 1 });
    expect(await new DtoKitValidationPipe({ transform: true }).transform({ name: "x" }, meta(Plain))).toBeInstanceOf(Plain);
  });

  it("strips __proto__ / constructor keys", async () => {
    const evil = JSON.parse('{"city":"Rome","__proto__":{"polluted":true},"constructor":{"x":1}}');
    const out = await new DtoKitValidationPipe({ transform: true }).transform(evil, meta(AddressDto));
    expect(out.city).toBe("Rome");
    expect(({}).polluted).toBeUndefined();
    expect(Object.keys(out)).toEqual(["city"]);
  });

  it("formatIssueMessage prepends the parent path", () => {
    expect(formatIssueMessage({ message: "city must be x", path: ["address", "city"] })).toBe("address.city must be x");
    expect(formatIssueMessage({ message: "email must be x", path: ["email"] })).toBe("email must be x");
  });
});

// A real Nest application over HTTP.
// (esbuild doesn't emit `design:paramtypes` the way tsc does for a Nest project, so it is declared by hand.)
describe("inside a NestJS app", () => {
  @Controller("users")
  class UsersController {
    @Post()
    create(@Body() dto: CreateUserDto) {
      return { isInstance: dto instanceof CreateUserDto, age: dto.age, city: dto.addresses[0].city };
    }
    @Get(":id")
    one(@Param("id") id: number, @Query("verbose") verbose: boolean) {
      return { id, verbose, idType: typeof id };
    }
    @Post("schema")
    viaSchema(@Body({ schema: schema(CreateUserDto) }) dto: CreateUserDto) {
      return { isInstance: dto instanceof CreateUserDto, age: dto.age };
    }
  }
  Reflect.defineMetadata("design:paramtypes", [CreateUserDto], UsersController.prototype, "create");
  Reflect.defineMetadata("design:paramtypes", [Number, Boolean], UsersController.prototype, "one");
  Reflect.defineMetadata("design:paramtypes", [CreateUserDto], UsersController.prototype, "viaSchema");

  let app;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [UsersController] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new DtoKitValidationPipe({ transform: true }), new StandardSchemaValidationPipe());
    await app.init();
  });
  afterAll(() => app.close());

  it("201 + a real DTO instance for a valid body", async () => {
    const res = await request(app.getHttpServer()).post("/users").send(good).expect(201);
    expect(res.body).toEqual({ isInstance: true, age: 30, city: "Rome" });
  });

  it("400 with the standard Nest error body for an invalid one", async () => {
    const res = await request(app.getHttpServer()).post("/users").send({ ...good, email: "nope" }).expect(400);
    expect(res.body).toEqual({ statusCode: 400, error: "Bad Request", message: ["email must be an email"] });
  });

  it("converts @Param / @Query primitives", async () => {
    const res = await request(app.getHttpServer()).get("/users/42?verbose=true").expect(200);
    expect(res.body).toEqual({ id: 42, verbose: true, idType: "number" });
  });

  it("works with Nest 12's native Standard Schema support: @Body({ schema: schema(Dto) })", async () => {
    const ok = await request(app.getHttpServer()).post("/users/schema").send(good).expect(201);
    expect(ok.body.isInstance).toBe(true);
    const bad = await request(app.getHttpServer()).post("/users/schema").send({ ...good, age: 3 }).expect(400);
    expect(JSON.stringify(bad.body)).toContain("age");
  });
});

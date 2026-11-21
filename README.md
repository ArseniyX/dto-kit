# dto-kit

Decorator-based DTO validation and transformation for TypeScript. Works with **TC39 standard decorators** (no `reflect-metadata`, no
`experimentalDecorators`) and with TypeScript's legacy `experimentalDecorators` (so it runs inside NestJS). Every DTO class is a
[Standard Schema](https://standardschema.dev).

Aimed at replacing the `class-validator` + `class-transformer` pair (each ~18M weekly npm downloads;
class-transformer has had no release since 2021).

```ts
import { IsEmail, IsInt, Min, Expose, Exclude, Optional, parse, instanceToPlain, schema } from "dto-kit";

class User {
  @IsEmail() email!: string;
  @IsInt() @Min(18) age!: number;
  @Expose({ name: "user_name" }) @IsString() username!: string;
  @Exclude() @IsString() password!: string;
  @Optional() @IsString() bio?: string;
}

const r = parse(User, body);          // { success, value | issues }
instanceToPlain(r.value);             // honors @Expose / @Exclude
const s = schema(User);               // Standard Schema (tRPC, TanStack Form, ...)
```

## Status
Early. Implemented:
- Core: `@Optional`, `@Expose`, `@Exclude`, `@Each`, `@ValidateIf`, `@Transform`, `@Type`, `@Nested`, inheritance, strict mode, Standard Schema.
- `@Type(() => Number | String | Boolean | Date)` coercion for query params and forms.
- **Nested DTOs**: `@Nested(() => Dto)` builds instances from plain JSON; objects, arrays, Sets and Maps at any depth (paths use the
  index / Map key). `@ValidateNested()` (class-validator style) needs no type when you pass class instances. `@Nested(() => Dto, { each: true })`
  insists on a single-level array. Non-objects report `nestedValidation`.
- ~75 rules: hand-written (`IsString`, `Min`, `MinLength`, `IsEnum`, `ArrayMinSize`, ...) plus ~45 string formats backed by validator.js (`IsEmail`, `IsUUID`, `IsURL`, ...).
- **Per-rule options** on every rule, same shape as class-validator: `{ message, each, groups, always, context, validateIf }`.
  Messages support `$value`, `$property`, `$target`, `$constraint1..N`, or a function. `each` works on arrays, Sets and Maps.
- **Groups**: `parse(Cls, input, { groups, always, strictGroups })` with class-validator's filtering rules, including nested DTOs.
- **Whitelisting**: unknown input keys are dropped from the result by default (input is never mutated). `forbidNonWhitelisted` (alias `strict`)
  reports them as `whitelistValidation`; `whitelist: false` copies them through. `@Allow()` whitelists a field without validating it;
  `@IsOptional` (= `@Optional`) and `@IsDefined({ message, context })` also exist.
- `stopAtFirstError`; every issue carries a `code` (rule name) and the rule's `context`.
- **Custom rules**: `registerDecorator({ context, validator, ... })`, `buildMessage()`, or a reusable `@ValidatorConstraint()` class with `@Validate()`.
- **Async**: `@Validate(MyConstraint)` + `@ValidatorConstraint()`; use `parseAsync()` (sync `parse()` throws if it meets an async rule).

Differences from class-validator worth knowing: inherited fields are reported parent-first; input is a plain object (dto-kit builds the instance); a missing required
field is a single `isDefined` issue rather than every rule failing on `undefined`; `IsEmpty` (null-is-valid) isn't supported;
default messages are subject-less (`"must be a string"`, the `path` names the field).
Several `@Transform`s on one property apply top decorator first, as in class-transformer.

## Migrating from class-validator / class-transformer
```
npx dto-kit-codemod src            # dry run: reports what would change
npx dto-kit-codemod src --write    # apply it
npx dto-kit-codemod src --nest --write   # also swap Nest's ValidationPipe for DtoKitValidationPipe
npx dto-kit-codemod src --check    # exit 1 if anything would still change (CI)
```
It rewrites `class-validator` / `class-transformer` imports to `dto-kit` (one merged import, quote and semicolon style kept), renames
`IsUrl` → `IsURL`, `IsNumberString` → `IsNumericString`, `IsDateString` → `IsISO8601` at every use, and adds `{ container: Map | Set }`
to `@Type` on `Map` / `Set` fields. Names dto-kit doesn't have stay on the old import with a `TODO(dto-kit)` comment and a warning, so the
file still compiles while you deal with them. Running it twice changes nothing the second time.

It does not change behaviour for you; it warns about the things that need a person:
`validate()` / `Validator` / `ValidationError` (use `parse()`), `IsEmpty`, `@ValidateNested()` with no `@Type` (dto-kit builds nested DTOs
from plain input and needs the class), `enableImplicitConversion`, and the Nest pipe options dto-kit doesn't support. It works on source text
with a small tokenizer (strings, comments, template literals and regex literals are skipped), not a full parser, so it won't follow
aliased re-exports or `require()` calls. `import { ... } from "dto-kit/codemod"` exposes `transformSource()` for your own tooling.

## NestJS
```ts
import { DtoKitValidationPipe } from "dto-kit/nest";
app.useGlobalPipes(new DtoKitValidationPipe({ transform: true }));   // instead of ValidationPipe
```
A drop-in for Nest's `ValidationPipe` (Nest 9 to 12): the DTO class on the parameter drives validation, errors come back as the usual
`{ statusCode: 400, message: ["email must be an email", "addresses.0.city must be ..."], error: "Bad Request" }`, and your DTOs just
swap their `class-validator`/`class-transformer` imports for `dto-kit`. Nest projects use `experimentalDecorators`; dto-kit's decorators
detect which calling convention they were given, so the same DTO file works in both modes. Nothing else changes in your tsconfig
(`emitDecoratorMetadata` is still what gives Nest the parameter's class).

Supported options: `transform`, `transformOptions`, `whitelist`, `forbidNonWhitelisted`, `groups`, `always`, `strictGroups`,
`stopAtFirstError`, `skipMissingProperties` / `skipNullProperties` / `skipUndefinedProperties`, `errorHttpStatusCode`,
`exceptionFactory` (receives dto-kit issues), `disableErrorMessages`, `validateCustomDecorators`, `expectedType`.
Not supported: `forbidUnknownValues`, `validationError`, `errorFormat`, `maxErrorMessagesLength`, `dismissDefaultMessages`,
`enableDebugMessages`. A parameter whose class has no dto-kit decorators is passed through unvalidated (as in Nest 12).
`transform: false` (Nest's default) hands the original body back; `transform: true` returns the DTO instance (nested DTOs, `@Type`
coercion and `@Transform`s applied).

**Nest 12** also understands Standard Schema natively, which needs no pipe at all: `@Body({ schema: schema(CreateUserDto) }) dto`.
`schema()` returns a Promise only if the DTO has an async rule.

## class-transformer compatibility
`plainToInstance`, `instanceToPlain`, `instanceToInstance` (+ `...FromExist`, `serialize`/`deserialize`, the old `classToPlain`/`plainToClass`
names, `ClassTransformer`, and the `@TransformInstanceToPlain`/`ToInstance`/`@TransformPlainToInstance` method decorators) are a port of
class-transformer's executor, driven by the same `@Expose`, `@Exclude`, `@Type`, `@Transform` decorators that `parse()` uses
(so one set of decorators does both transformation and validation). Supported: strategies, groups, versions (`since`/`until`),
`toClassOnly`/`toPlainOnly`, `excludePrefixes`, `excludeExtraneousValues`, `ignoreDecorators`, `targetMaps`, `exposeDefaultValues`,
`exposeUnsetFields`, circular checks, discriminators, Maps, Sets, Promises, `@Expose` on getters/methods and on classes.

Not supported, by design: anything that reads a field's declared TypeScript type through `reflect-metadata`'s `design:type`:
- `enableImplicitConversion`: say it explicitly with `@Type(() => Number)`.
- `Map`/`Set` fields: add `{ container: Map }` / `{ container: Set }` (`@Type(() => Weapon, { container: Map })`), or `@Type(() => Map)`.

## Custom decorators
class-validator's `registerDecorator({ target, propertyName })` needs legacy decorators. With standard decorators you pass the
decorator `context` instead:

```ts
function IsLongerThan(property: string, options?: ValidationOptions) {
  return (_value: undefined, context: ClassFieldDecoratorContext) =>
    registerDecorator({
      context, options, constraints: [property], name: "isLongerThan",
      validator: {
        validate: (value, args) => String(value).length > String(args.object[args.constraints[0]]).length,
        defaultMessage: (args) => `${args.property} must be longer than ${args.constraints[0]}`,
      },
    });
}
```

## Roadmap
- [ ] Circular references in nested DTOs, `whitelist`/`forbidNonWhitelisted` naming parity
- [ ] Remaining validators (long tail: ISO codes, phone numbers)
- [ ] Codemod: `require()` / re-exports, `ValidationPipe` options, `registerDecorator` rewrites
- [ ] Nest: `errorFormat`, `forbidUnknownValues`; a `ClassSerializerInterceptor` equivalent

## class-transformer parity tests
`test/ct/` holds class-transformer's 15 specs (96 tests) copied with only mechanical edits: imports, `reflect-metadata` and storage-clear
lines removed, undecorated field declarations dropped (esbuild emits `this.x = undefined` for them, TypeScript's legacy output did not),
`{ container }` added to the 5 `Map`/`Set` fields in the ES6 spec, and 7 `design:type` tests skipped. Regenerate with
`node scripts/port-ct.mjs /path/to/class-transformer`.

## Tests
`test/legacy/` is compiled with `experimentalDecorators` (the way a NestJS project compiles) and includes a real Nest application driven
over HTTP with supertest. esbuild can't emit `design:paramtypes`, so that test declares each handler's parameter types by hand;
in a real project `tsc` does it.

## Dev
```
npm test        # vitest (esbuild pre-transform; Vite 8's Oxc doesn't lower standard decorators yet)
npm run build   # tsup -> ESM + CJS + d.ts
```

## Parity tests
`test/cv/` is derived from [class-validator](https://github.com/typestack/class-validator)'s test suite
(MIT, Copyright (c) 2015-2020 TypeStack). Regenerate with:
```
git clone --depth 1 https://github.com/typestack/class-validator.git /tmp/cv
node scripts/port-cv.mjs /tmp/cv && node scripts/gen-shim.mjs && node scripts/todo-cv.mjs /tmp/cv
```
- `decorators.generated.test.ts`: valid/invalid value tables for every decorator (113 blocks).
- `validation-options`, `custom-decorators`, `nested-validation`, `conditional-validation`, `whitelist-validation`, `inherited-validation` (`test/cv/*.test.ts`): hand-ports of those specs.
- `test/ct/*.test.ts`: class-transformer's own specs, generated by `scripts/port-ct.mjs` (see below).
- `pending.test.ts`: `it.todo` for every API-level test dto-kit can't pass yet (groups, async, custom constraints, `ValidationError` shape, ...).

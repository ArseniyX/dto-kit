// NestJS integration: a drop-in replacement for Nest's `ValidationPipe` that validates DTOs with dto-kit instead of
// class-validator + class-transformer.   import { DtoKitValidationPipe } from "dto-kit/nest";
//
// Nest 12 also understands Standard Schema natively, so there `@Body({ schema: schema(CreateUserDto) })` works without
// this pipe. This pipe is for the usual style (the DTO type on the parameter) and for Nest 9-11.
import { BadRequestException, HttpException, HttpStatus, Injectable, type ArgumentMetadata, type PipeTransform, type Type } from "@nestjs/common";
import { parseAsync, type Issue, type ParseOptions } from "./schema.js";
import { instanceToPlain, plainToInstance } from "./transformer.js";
import { hasFields } from "./metadata.js";
import type { ClassTransformOptions } from "./transform-meta.js";

export interface DtoKitValidationPipeOptions
  extends Pick<ParseOptions, "groups" | "always" | "strictGroups" | "stopAtFirstError" | "skipMissingProperties" | "skipNullProperties" | "skipUndefinedProperties"> {
  /** Return the DTO instance (true) instead of the validated plain value (false, Nest's default). */
  transform?: boolean;
  /** Used when converting the DTO back to a plain object (transform: false with whitelist). */
  transformOptions?: ClassTransformOptions;
  /** Strip properties that aren't declared on the DTO (default false, like Nest). */
  whitelist?: boolean;
  /** Reject properties that aren't declared on the DTO. */
  forbidNonWhitelisted?: boolean;
  /** Respond with a bare `Bad Request` instead of the list of messages. */
  disableErrorMessages?: boolean;
  errorHttpStatusCode?: number;
  /** Build your own exception from the issues. */
  exceptionFactory?: (issues: Issue[]) => unknown;
  /** Also validate parameters from custom decorators (default false). */
  validateCustomDecorators?: boolean;
  /** Validate every parameter against this class instead of its declared type. */
  expectedType?: Type<any>;
}

/** "address.city must be a string": issue messages start with the property name, the parent path is prepended. */
export function formatIssueMessage(issue: Issue): string {
  const parent = issue.path.slice(0, -1).join(".");
  return parent ? `${parent}.${issue.message}` : issue.message;
}

const PRIMITIVE_TYPES: unknown[] = [String, Boolean, Number, Array, Object, Buffer, Date];
const isNil = (v: unknown): v is null | undefined => v === null || v === undefined;

export class DtoKitValidationPipe implements PipeTransform<any> {
  protected readonly isTransformEnabled: boolean;
  protected readonly transformOptions: ClassTransformOptions | undefined;
  protected readonly errorHttpStatusCode: number;
  protected readonly validateCustomDecorators: boolean;
  protected readonly expectedType: Type<any> | undefined;
  protected readonly whitelist: boolean;
  protected readonly parseOptions: ParseOptions;
  protected readonly exceptionFactory: (issues: Issue[]) => unknown;

  constructor(options: DtoKitValidationPipeOptions = {}) {
    const {
      transform = false, transformOptions, whitelist = false, forbidNonWhitelisted = false, disableErrorMessages = false,
      errorHttpStatusCode = HttpStatus.BAD_REQUEST, exceptionFactory, validateCustomDecorators = false, expectedType, ...parse
    } = options;
    this.isTransformEnabled = transform;
    this.transformOptions = transformOptions;
    this.whitelist = whitelist;
    this.errorHttpStatusCode = errorHttpStatusCode;
    this.validateCustomDecorators = validateCustomDecorators;
    this.expectedType = expectedType;
    // dto-kit strips unknown keys by default; Nest's default is to keep them
    this.parseOptions = { ...parse, whitelist, forbidNonWhitelisted };
    this.exceptionFactory =
      exceptionFactory ??
      ((issues) => {
        const status = this.errorHttpStatusCode;
        const message = disableErrorMessages ? undefined : issues.map(formatIssueMessage);
        if (status === HttpStatus.BAD_REQUEST) return new BadRequestException(message);
        return new HttpException({ statusCode: status, message, error: HttpStatus[status] }, status);
      });
  }

  async transform(value: any, metadata: ArgumentMetadata): Promise<any> {
    if (this.expectedType) metadata = { ...metadata, metatype: this.expectedType };
    const metatype = metadata.metatype;
    if (!metatype || !this.toValidate(metadata)) {
      return this.isTransformEnabled ? this.transformPrimitive(value, metadata) : value;
    }
    // a class with no dto-kit rules has nothing to validate (Nest 12's pipe skips these too): don't fail the request with a 500
    if (!hasFields(metatype)) return this.isTransformEnabled && value !== null && typeof value === "object" ? plainToInstance(metatype as any, value, this.transformOptions) : value;
    const originalValue = value;
    value = this.toEmptyIfNil(value, metadata.type);
    const wasNil = value !== originalValue;
    this.stripProtoKeys(value);

    const result = await parseAsync(metatype as new () => unknown, value, this.parseOptions);
    if (!result.success) throw this.exceptionFactory(result.issues);

    if (this.isTransformEnabled) return result.value;
    if (wasNil) return originalValue; // null/undefined body: nothing to transform, hand it back as received
    return this.whitelist || this.parseOptions.forbidNonWhitelisted ? instanceToPlain(result.value as object, this.transformOptions) : value;
  }

  protected toValidate(metadata: ArgumentMetadata): boolean {
    const { metatype, type } = metadata;
    if (type === "custom" && !this.validateCustomDecorators) return false;
    return !PRIMITIVE_TYPES.some((t) => metatype === t) && !isNil(metatype);
  }

  /** With transform on, `@Param("id") id: number` is converted to a number (as Nest's ValidationPipe does). */
  protected transformPrimitive(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!metadata.data) return value; // only named params/queries (a whole-object read is left alone)
    const { type, metatype } = metadata;
    if (type !== "param" && type !== "query") return value;
    if (metatype === Boolean) return value === undefined ? undefined : value === true || value === "true";
    if (metatype === Number) return +(value as any);
    if (metatype === String && value !== undefined) return String(value);
    return value;
  }

  protected toEmptyIfNil(value: unknown, type: ArgumentMetadata["type"]): unknown {
    if (!isNil(value)) return value;
    return type === "body" || type === "query" ? {} : value;
  }

  /** Remove `__proto__` / `constructor` keys (prototype pollution), recursively. */
  protected stripProtoKeys(value: any): void {
    if (value === null || typeof value !== "object") return;
    delete value.__proto__;
    delete value.constructor;
    for (const k of Object.keys(value)) this.stripProtoKeys(value[k]);
  }
}
// Nest's DI needs the injectable watermark; applying the decorator as a function keeps this file free of decorator syntax,
// so it compiles the same under standard and legacy decorators.
Injectable()(DtoKitValidationPipe);

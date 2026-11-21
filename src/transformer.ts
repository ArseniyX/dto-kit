// Port of class-transformer's TransformOperationExecutor + ClassTransformer API
// (MIT, Copyright (c) 2015-2020 TypeStack), on top of dto-kit's standard-decorator metadata.
import {
  TransformationType, findExposeMetadata, findExposeMetadataByCustomName, findTransformMetadatas, findTypeMetadata,
  getExcludedProperties, getExposedProperties, getStrategy,
  type ClassTransformOptions, type TypeHelpOptions, type TypeMeta, type TypeOptions,
} from "./transform-meta.js";

export type ClassConstructor<T> = { new (...args: any[]): T };

const isPromise = (p: any): p is Promise<unknown> => p !== null && typeof p === "object" && typeof p.then === "function";

function instantiateArrayType(arrayType: Function): any[] | Set<any> {
  const array = new (arrayType as any)();
  if (!(array instanceof Set) && !("push" in array)) return [];
  return array;
}

const defaultOptions: Partial<ClassTransformOptions> = {
  enableCircularCheck: false,
  enableImplicitConversion: false,
  excludeExtraneousValues: false,
  excludePrefixes: undefined,
  exposeDefaultValues: false,
  exposeUnsetFields: true,
  groups: undefined,
  ignoreDecorators: false,
  strategy: undefined,
  targetMaps: undefined,
  version: undefined,
};

/** What a field's @Type resolves to: the element/target type plus whether the field is a Map/Set container. */
function resolveType(metadata: TypeMeta, help: TypeHelpOptions): { type: any; container?: Function } {
  let type = metadata.typeFunction ? metadata.typeFunction(help) : undefined;
  let container: Function | undefined = metadata.options.container;
  // @Type(() => Set) / @Type(() => Map): the field itself is the container, elements keep their natural type
  if (!container && (type === Set || type === Map) && !metadata.options.discriminator) {
    container = type;
    type = undefined;
  }
  return { type, container };
}

export class TransformOperationExecutor {
  private recursionStack = new Set<Record<string, any>>();

  constructor(private transformationType: TransformationType, private options: ClassTransformOptions) {}

  transform(source: any, value: any, targetType: Function | TypeMeta | undefined, arrayType: Function | undefined, isMap: boolean | undefined, level = 0): any {
    if (Array.isArray(value) || value instanceof Set) {
      const newValue = arrayType && this.transformationType === TransformationType.PLAIN_TO_CLASS ? instantiateArrayType(arrayType) : [];
      (value as any[]).forEach((subValue, index) => {
        const subSource = source ? source[index] : undefined;
        if (!this.options.enableCircularCheck || !this.isCircular(subValue)) {
          let realTargetType: any;
          const tt = targetType as any;
          if (typeof targetType !== "function" && targetType && tt.options && tt.options.discriminator && tt.options.discriminator.property && tt.options.discriminator.subTypes) {
            if (this.transformationType === TransformationType.PLAIN_TO_CLASS) {
              realTargetType = tt.options.discriminator.subTypes.find((subType: any) => subType.name === subValue[tt.options.discriminator.property]);
              const options: TypeHelpOptions = { newObject: newValue, object: subValue, property: undefined };
              const newType = tt.typeFunction(options);
              realTargetType === undefined ? (realTargetType = newType) : (realTargetType = realTargetType.value);
              if (!tt.options.keepDiscriminatorProperty) delete subValue[tt.options.discriminator.property];
            }
            if (this.transformationType === TransformationType.CLASS_TO_CLASS) realTargetType = subValue.constructor;
            if (this.transformationType === TransformationType.CLASS_TO_PLAIN) {
              subValue[tt.options.discriminator.property] = tt.options.discriminator.subTypes.find((subType: any) => subType.value === subValue.constructor).name;
            }
          } else {
            realTargetType = targetType;
          }
          const v = this.transform(subSource, subValue, realTargetType, undefined, subValue instanceof Map, level + 1);
          if (newValue instanceof Set) newValue.add(v);
          else newValue.push(v);
        } else if (this.transformationType === TransformationType.CLASS_TO_CLASS) {
          if (newValue instanceof Set) newValue.add(subValue);
          else newValue.push(subValue);
        }
      });
      return newValue;
    } else if (targetType === String && !isMap) {
      if (value === null || value === undefined) return value;
      return String(value);
    } else if (targetType === Number && !isMap) {
      if (value === null || value === undefined) return value;
      return Number(value);
    } else if (targetType === Boolean && !isMap) {
      if (value === null || value === undefined) return value;
      return Boolean(value);
    } else if ((targetType === Date || value instanceof Date) && !isMap) {
      if (value instanceof Date) return new Date(value.valueOf());
      if (value === null || value === undefined) return value;
      return new Date(value);
    } else if (!!(globalThis as any).Buffer && (targetType === (globalThis as any).Buffer || value instanceof (globalThis as any).Buffer) && !isMap) {
      if (value === null || value === undefined) return value;
      return (globalThis as any).Buffer.from(value);
    } else if (isPromise(value) && !isMap) {
      return new Promise((resolve, reject) => {
        (value as Promise<any>).then((data: any) => resolve(this.transform(undefined, data, targetType, undefined, undefined, level + 1)), reject);
      });
    } else if (!isMap && value !== null && typeof value === "object" && typeof value.then === "function") {
      return value; // thenable that isn't a real Promise: leave as is
    } else if (typeof value === "object" && value !== null) {
      // try to guess the type
      if (!targetType && value.constructor !== Object) {
        if (!Array.isArray(value) && value.constructor === Array) {
          // special Array-like object (e.g. { '100000000': 1, __proto__: [] }): never convert it, it's a DoS vector
        } else {
          targetType = value.constructor;
        }
      }
      if (!targetType && source) targetType = source.constructor;

      if (this.options.enableCircularCheck) this.recursionStack.add(value);

      const keys = this.getKeys(targetType as Function, value, !!isMap);
      let newValue: any = source ? source : {};
      if (!source && (this.transformationType === TransformationType.PLAIN_TO_CLASS || this.transformationType === TransformationType.CLASS_TO_CLASS)) {
        if (isMap) newValue = new Map();
        else if (targetType) newValue = new (targetType as any)();
        else newValue = {};
      }

      for (const key of keys) {
        if (key === "__proto__" || key === "constructor") continue;

        const valueKey = key;
        let newValueKey = key,
          propertyName = key;
        if (!this.options.ignoreDecorators && targetType) {
          if (this.transformationType === TransformationType.PLAIN_TO_CLASS) {
            const exposeMetadata = findExposeMetadataByCustomName(targetType as Function, key);
            if (exposeMetadata) {
              propertyName = exposeMetadata.propertyName;
              newValueKey = exposeMetadata.propertyName;
            }
          } else if (this.transformationType === TransformationType.CLASS_TO_PLAIN || this.transformationType === TransformationType.CLASS_TO_CLASS) {
            const exposeMetadata = findExposeMetadata(targetType as Function, key);
            if (exposeMetadata && exposeMetadata.options && exposeMetadata.options.name) newValueKey = exposeMetadata.options.name;
          }
        }

        // get a subvalue (never call functions when going to a class)
        let subValue: any = undefined;
        if (this.transformationType === TransformationType.PLAIN_TO_CLASS) {
          subValue = value[valueKey];
        } else if (value instanceof Map) {
          subValue = value.get(valueKey);
        } else if (value[valueKey] instanceof Function) {
          subValue = value[valueKey]();
        } else {
          subValue = value[valueKey];
        }

        // determine a type
        let type: any = undefined,
          isSubValueMap = subValue instanceof Map,
          container: Function | undefined;
        if (targetType && isMap) {
          type = targetType;
        } else if (targetType) {
          const metadata = findTypeMetadata(targetType as Function, propertyName);
          if (metadata) {
            const help: TypeHelpOptions = { newObject: newValue, object: value, property: propertyName };
            const resolved = resolveType(metadata, help);
            const newType = resolved.type;
            container = resolved.container;
            const o = metadata.options as TypeOptions;
            if (o && o.discriminator && o.discriminator.property && o.discriminator.subTypes) {
              if (!(value[valueKey] instanceof Array)) {
                if (this.transformationType === TransformationType.PLAIN_TO_CLASS) {
                  type = o.discriminator.subTypes.find((subType) => {
                    if (subValue && subValue instanceof Object && o.discriminator!.property in subValue) return subType.name === subValue[o.discriminator!.property];
                  });
                  type === undefined ? (type = newType) : (type = type.value);
                  if (!o.keepDiscriminatorProperty) {
                    if (subValue && subValue instanceof Object && o.discriminator.property in subValue) delete subValue[o.discriminator.property];
                  }
                }
                if (this.transformationType === TransformationType.CLASS_TO_CLASS) type = subValue.constructor;
                if (this.transformationType === TransformationType.CLASS_TO_PLAIN) {
                  if (subValue) subValue[o.discriminator.property] = o.discriminator.subTypes.find((subType) => subType.value === subValue.constructor)!.name;
                }
              } else {
                type = metadata;
              }
            } else {
              type = newType;
            }
            isSubValueMap = isSubValueMap || container === Map;
          } else if (this.options.targetMaps) {
            this.options.targetMaps.filter((map) => map.target === targetType && !!map.properties[propertyName]).forEach((map) => (type = map.properties[propertyName]));
          }
          // (enableImplicitConversion needs reflect-metadata's design:type, which dto-kit doesn't use)
        }

        // if value is an array, its container type (Set) comes from @Type's container / @Type(() => Set)
        const arrayType = Array.isArray(value[valueKey]) ? container : undefined;

        const subSource = source ? source[valueKey] : undefined;

        // never overwrite methods or getter-only accessors when building a class
        if (newValue.constructor.prototype) {
          const descriptor = this.getPropertyDescriptor(newValue.constructor.prototype, newValueKey);
          if ((this.transformationType === TransformationType.PLAIN_TO_CLASS || this.transformationType === TransformationType.CLASS_TO_CLASS) &&
              ((descriptor && !descriptor.set) || newValue[newValueKey] instanceof Function)) continue;
        }

        if (!this.options.enableCircularCheck || !this.isCircular(subValue)) {
          const transformKey = this.transformationType === TransformationType.PLAIN_TO_CLASS ? newValueKey : key;
          let finalValue;
          if (this.transformationType === TransformationType.CLASS_TO_PLAIN) {
            finalValue = value[transformKey];
            finalValue = this.applyCustomTransformations(finalValue, targetType as Function, transformKey, value, this.transformationType);
            // if nothing changed, no custom transformation was applied, so use the subValue
            finalValue = value[transformKey] === finalValue ? subValue : finalValue;
            finalValue = this.transform(subSource, finalValue, type, arrayType, isSubValueMap, level + 1);
          } else {
            if (subValue === undefined && this.options.exposeDefaultValues) {
              finalValue = newValue[newValueKey];
            } else {
              finalValue = this.transform(subSource, subValue, type, arrayType, isSubValueMap, level + 1);
              finalValue = this.applyCustomTransformations(finalValue, targetType as Function, transformKey, value, this.transformationType);
            }
          }
          if (finalValue !== undefined || this.options.exposeUnsetFields) {
            if (newValue instanceof Map) newValue.set(newValueKey, finalValue);
            else newValue[newValueKey] = finalValue;
          }
        } else if (this.transformationType === TransformationType.CLASS_TO_CLASS) {
          let finalValue = subValue;
          finalValue = this.applyCustomTransformations(finalValue, targetType as Function, key, value, this.transformationType);
          if (finalValue !== undefined || this.options.exposeUnsetFields) {
            if (newValue instanceof Map) newValue.set(newValueKey, finalValue);
            else newValue[newValueKey] = finalValue;
          }
        }
      }

      if (this.options.enableCircularCheck) this.recursionStack.delete(value);
      return newValue;
    } else {
      return value;
    }
  }

  private applyCustomTransformations(value: any, target: Function, key: string, obj: any, _t: TransformationType): any {
    let metadatas = findTransformMetadatas(target, key, this.transformationType);

    if (this.options.version !== undefined) {
      metadatas = metadatas.filter((m) => (!m.options ? true : this.checkVersion(m.options.since, m.options.until)));
    }
    if (this.options.groups && this.options.groups.length) {
      metadatas = metadatas.filter((m) => (!m.options ? true : this.checkGroups(m.options.groups)));
    } else {
      metadatas = metadatas.filter((m) => !m.options || !m.options.groups || !m.options.groups.length);
    }
    metadatas.forEach((m) => {
      value = m.fn({ value, key, obj, type: this.transformationType, options: this.options });
    });
    return value;
  }

  private isCircular(object: Record<string, any>): boolean {
    return this.recursionStack.has(object);
  }

  private getKeys(target: Function, object: Record<string, any>, isMap: boolean): string[] {
    let strategy: string = target ? getStrategy(target) : "none";
    if (strategy === "none") strategy = this.options.strategy || "exposeAll";

    let keys: any[] = [];
    if (strategy === "exposeAll" || isMap) {
      keys = object instanceof Map ? Array.from(object.keys()) : Object.keys(object);
    }
    if (isMap) return keys; // expose & exclude apply to fields only, not map keys

    // decorators ignored but extraneous values unwanted: use the metadata only to pick which properties are known
    if (this.options.ignoreDecorators && this.options.excludeExtraneousValues && target) {
      keys = [...getExposedProperties(target, this.transformationType), ...getExcludedProperties(target, this.transformationType)];
    }

    if (!this.options.ignoreDecorators && target) {
      let exposedProperties = getExposedProperties(target, this.transformationType);
      if (this.transformationType === TransformationType.PLAIN_TO_CLASS) {
        exposedProperties = exposedProperties.map((key) => {
          const m = findExposeMetadata(target, key);
          return m && m.options && m.options.name ? m.options.name : key;
        });
      }
      keys = this.options.excludeExtraneousValues ? exposedProperties : keys.concat(exposedProperties);

      const excludedProperties = getExcludedProperties(target, this.transformationType);
      if (excludedProperties.length > 0) keys = keys.filter((key) => !excludedProperties.includes(key));

      if (this.options.version !== undefined) {
        keys = keys.filter((key) => {
          const m = findExposeMetadata(target, key);
          return !m || !m.options ? true : this.checkVersion(m.options.since, m.options.until);
        });
      }
      if (this.options.groups && this.options.groups.length) {
        keys = keys.filter((key) => {
          const m = findExposeMetadata(target, key);
          return !m || !m.options ? true : this.checkGroups(m.options.groups);
        });
      } else {
        keys = keys.filter((key) => {
          const m = findExposeMetadata(target, key);
          return !m || !m.options || !m.options.groups || !m.options.groups.length;
        });
      }
    }

    if (this.options.excludePrefixes && this.options.excludePrefixes.length) {
      keys = keys.filter((key) => this.options.excludePrefixes!.every((prefix) => key.substr(0, prefix.length) !== prefix));
    }
    return keys.filter((key, index, self) => self.indexOf(key) === index);
  }

  private checkVersion(since: number | undefined, until: number | undefined): boolean {
    let decision = true;
    if (decision && since) decision = this.options.version! >= since;
    if (decision && until) decision = this.options.version! < until;
    return decision;
  }

  private checkGroups(groups: string[] | undefined): boolean {
    if (!groups) return true;
    return this.options.groups!.some((g) => groups.includes(g));
  }

  private getPropertyDescriptor(obj: any, key: PropertyKey): PropertyDescriptor | undefined {
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    if (descriptor) return descriptor;
    const prototype = Object.getPrototypeOf(obj);
    return prototype ? this.getPropertyDescriptor(prototype, key) : undefined;
  }
}

const run = (type: TransformationType, options: ClassTransformOptions | undefined, source: any, value: any, target?: any) =>
  new TransformOperationExecutor(type, { ...defaultOptions, ...options }).transform(source, value, target, undefined, undefined, undefined as any);

export function instanceToPlain<T extends Record<string, any>>(object: T, options?: ClassTransformOptions): Record<string, any>;
export function instanceToPlain<T extends Record<string, any>>(object: T[], options?: ClassTransformOptions): Record<string, any>[];
export function instanceToPlain(object: any, options?: ClassTransformOptions): any {
  return run(TransformationType.CLASS_TO_PLAIN, options, undefined, object);
}
export function classToPlainFromExist<T extends Record<string, any>, P>(object: T, plain: P | P[], options?: ClassTransformOptions): any {
  return run(TransformationType.CLASS_TO_PLAIN, options, plain, object);
}
export function plainToInstance<T extends Record<string, any>, V extends Array<any>>(cls: ClassConstructor<T>, plain: V, options?: ClassTransformOptions): T[];
export function plainToInstance<T extends Record<string, any>, V>(cls: ClassConstructor<T>, plain: V, options?: ClassTransformOptions): T;
export function plainToInstance(cls: any, plain: any, options?: ClassTransformOptions): any {
  return run(TransformationType.PLAIN_TO_CLASS, options, undefined, plain, cls);
}
export function plainToClassFromExist<T extends Record<string, any>, V>(clsObject: T, plain: V | V[], options?: ClassTransformOptions): any {
  return run(TransformationType.PLAIN_TO_CLASS, options, clsObject, plain);
}
export function instanceToInstance<T>(object: T, options?: ClassTransformOptions): T;
export function instanceToInstance<T>(object: T[], options?: ClassTransformOptions): T[];
export function instanceToInstance(object: any, options?: ClassTransformOptions): any {
  return run(TransformationType.CLASS_TO_CLASS, options, undefined, object);
}
export function classToClassFromExist<T>(object: T, fromObject: T | T[], options?: ClassTransformOptions): any {
  return run(TransformationType.CLASS_TO_CLASS, options, fromObject, object);
}
/** instanceToPlain + JSON.stringify. */
export function serialize<T>(object: T | T[], options?: ClassTransformOptions): string {
  return JSON.stringify(instanceToPlain(object as any, options));
}
export function deserialize<T>(cls: ClassConstructor<T>, json: string, options?: ClassTransformOptions): T {
  return plainToInstance(cls as any, JSON.parse(json), options) as T;
}
export function deserializeArray<T>(cls: ClassConstructor<T>, json: string, options?: ClassTransformOptions): T[] {
  return plainToInstance(cls as any, JSON.parse(json), options) as T[];
}
/** class-transformer's older names. */
export const classToPlain = instanceToPlain;
export const plainToClass = plainToInstance;
export const classToClass = instanceToInstance;

/** Class-based API, as in class-transformer. */
export class ClassTransformer {
  instanceToPlain = instanceToPlain;
  classToPlainFromExist = classToPlainFromExist;
  plainToInstance = plainToInstance;
  plainToClassFromExist = plainToClassFromExist;
  instanceToInstance = instanceToInstance;
  classToClassFromExist = classToClassFromExist;
  serialize = serialize;
  deserialize = deserialize;
  deserializeArray = deserializeArray;
}

// ---- method decorators ---------------------------------------------------------------------------
const wrap = (finish: (data: any) => any) => (a: any, b?: any, c?: any): any => {
  const wrapped = (original: Function) =>
    function (this: unknown, ...args: any[]) {
      const result: any = original.apply(this, args);
      const promise = !!result && (typeof result === "object" || typeof result === "function") && typeof result.then === "function";
      return promise ? result.then(finish) : finish(result);
    };
  // legacy: (prototype, key, descriptor) mutates the descriptor; standard: (method, context) returns the replacement
  if (c && typeof c === "object" && "value" in c) {
    c.value = wrapped(c.value);
    return;
  }
  return wrapped(a);
};
export const TransformInstanceToPlain = (params?: ClassTransformOptions) => wrap((d) => instanceToPlain(d, params));
export const TransformInstanceToInstance = (params?: ClassTransformOptions) => wrap((d) => instanceToInstance(d, params));
export const TransformPlainToInstance = (classType: ClassConstructor<any>, params?: ClassTransformOptions) =>
  wrap((d) => plainToInstance(classType, d, params));

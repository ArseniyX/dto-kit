// String-format rules backed by validator.js (the same engine class-validator uses).
import validator from "validator";
import { rule } from "./internal.js";
import { isValidationOptions, type ValidationOptions } from "./validation.js";

type V = typeof validator;
type StrFns = { [K in keyof V]: V[K] extends (s: string, ...a: never[]) => boolean ? K : never }[keyof V];
type Rest<K extends StrFns> = V[K] extends (s: string, ...r: infer R) => boolean ? R : never;

/**
 * Build a decorator factory from a validator.js predicate. Args are forwarded after the string;
 * a trailing ValidationOptions object (message, each, groups, ...) is recognised and split off.
 */
function make<K extends StrFns>(name: K, label: string, code: string = name) {
  const fn = validator[name] as unknown as (s: string, ...a: unknown[]) => boolean;
  return (...all: Rest<K> | [...unknown[], ValidationOptions]) => {
    const args = [...all] as unknown[];
    const o = isValidationOptions(args[args.length - 1]) ? (args.pop() as ValidationOptions) : undefined;
    return rule(code, (v) => (typeof v === "string" && fn(v, ...args) ? undefined : `must be ${label}`), o, args);
  };
}

export const IsEmail = make("isEmail", "an email");
/** `version` may be a single version or a list (any match is valid). */
export const IsUUID = (version?: validator.UUIDVersion | validator.UUIDVersion[], o?: ValidationOptions) =>
  rule(
    "isUUID",
    (v) => {
      const versions = Array.isArray(version) ? version : [version ?? "all"];
      return typeof v === "string" && versions.some((x) => validator.isUUID(v, x as validator.UUIDVersion)) ? undefined : "must be a UUID";
    },
    o,
    [version],
  );
export const IsURL = make("isURL", "a URL");
export const IsISO8601 = make("isISO8601", "an ISO 8601 date string");
export const IsRFC3339 = make("isRFC3339", "an RFC 3339 date string");
export const IsJSON = make("isJSON", "a JSON string");
export const IsJWT = make("isJWT", "a JWT");
export const IsAlpha = make("isAlpha", "letters only");
export const IsAlphanumeric = make("isAlphanumeric", "letters and digits only");
export const IsNumericString = make("isNumeric", "a numeric string");
export const IsDecimal = make("isDecimal", "a decimal string");
export const IsHexadecimal = make("isHexadecimal", "hexadecimal");
export const IsHexColor = make("isHexColor", "a hex color");
export const IsAscii = make("isAscii", "ASCII only");
export const IsBase64 = make("isBase64", "base64");
export const IsBase32 = make("isBase32", "base32");
export const IsLowercase = make("isLowercase", "lowercase");
export const IsUppercase = make("isUppercase", "uppercase");
export const IsIP = make("isIP", "an IP address");
export const IsMACAddress = make("isMACAddress", "a MAC address");
export const IsPort = make("isPort", "a port number");
export const IsFQDN = make("isFQDN", "a fully qualified domain name");
export const IsMobilePhone = make("isMobilePhone", "a mobile phone number");
export const IsPostalCode = make("isPostalCode", "a postal code");
export const IsCreditCard = make("isCreditCard", "a credit card number");
export const IsIBAN = make("isIBAN", "an IBAN");
export const IsBIC = make("isBIC", "a BIC/SWIFT code");
export const IsISBN = make("isISBN", "an ISBN");
export const IsISSN = make("isISSN", "an ISSN");
export const IsEAN = make("isEAN", "an EAN");
export const IsMongoId = make("isMongoId", "a MongoDB ObjectId");
export const IsSemVer = make("isSemVer", "a semantic version");
export const IsSlug = make("isSlug", "a slug");
export const IsDataURI = make("isDataURI", "a data URI");
export const IsMimeType = make("isMimeType", "a MIME type");
export const IsCurrency = make("isCurrency", "a currency amount");
export const IsEthereumAddress = make("isEthereumAddress", "an Ethereum address");
export const IsBtcAddress = make("isBtcAddress", "a Bitcoin address");
export const IsHash = make("isHash", "a hash");
export const IsLocale = make("isLocale", "a locale");
// Overloaded in @types/validator, so the generic factory can't infer its args.
export const IsStrongPassword = (opts?: validator.StrongPasswordOptions, o?: ValidationOptions) =>
  rule(
    "isStrongPassword",
    (v) => (typeof v === "string" && validator.isStrongPassword(v, { ...opts, returnScore: false }) ? undefined : "must be a strong password"),
    o,
    [opts],
  );
export const Contains = make("contains", "containing the required text");
export const NotContains = (seed: string, o?: ValidationOptions) =>
  rule("notContains", (v) => (typeof v === "string" && !validator.contains(v, seed) ? undefined : `must not contain "${seed}"`), o, [seed]);
export const IsBooleanString = make("isBoolean", "a boolean string", "isBooleanString");
export const IsFullWidth = make("isFullWidth", "full-width characters");
export const IsHalfWidth = make("isHalfWidth", "half-width characters");
export const IsVariableWidth = make("isVariableWidth", "full-width and half-width characters");
export const IsMultibyte = make("isMultibyte", "multibyte characters");
export const IsSurrogatePair = make("isSurrogatePair", "surrogate pairs");
export const IsOctal = make("isOctal", "an octal number");
export const IsMagnetURI = make("isMagnetURI", "a magnet URI");
export const IsPassportNumber = make("isPassportNumber", "a passport number");
export const IsISRC = make("isISRC", "an ISRC");
export const IsIdentityCard = make("isIdentityCard", "an identity card number");
export const IsTaxId = make("isTaxID", "a tax ID");
export const IsRgbColor = make("isRgbColor", "an RGB color");
export const IsHSL = make("isHSL", "an HSL color");
export const IsBase58 = (o?: ValidationOptions) =>
  rule("isBase58", (v) => (typeof v === "string" && /^[A-HJ-NP-Za-km-z1-9]*$/.test(v) ? undefined : "must be base58"), o);
export const IsLatLong = make("isLatLong", "a latitude,longitude pair");
export const IsLatitude = (o?: ValidationOptions) =>
  rule("isLatitude", (v) => ((typeof v === "number" || typeof v === "string") && validator.isLatLong(`${v},0`) ? undefined : "must be a latitude"), o);
export const IsLongitude = (o?: ValidationOptions) =>
  rule("isLongitude", (v) => ((typeof v === "number" || typeof v === "string") && validator.isLatLong(`0,${v}`) ? undefined : "must be a longitude"), o);
export const IsByteLength = (min: number, max?: number, o?: ValidationOptions) =>
  rule("isByteLength", (v) => (typeof v === "string" && validator.isByteLength(v, { min, max }) ? undefined : `byte length must be between ${min} and ${max ?? "∞"}`), o, [min, max]);
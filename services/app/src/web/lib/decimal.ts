/**
 * Exact arithmetic on the ledger's decimal strings ("-12.50"). Amounts never pass through
 * floating point, not even in the browser: they're scaled integers (BigInt) while being added.
 */

const DECIMAL = /^-?\d+(\.\d+)?$/;

type Scaled = { units: bigint; scale: number };

export function isDecimal(value: string): boolean {
  return DECIMAL.test(value);
}

function parse(value: string): Scaled {
  if (!isDecimal(value)) throw new Error(`not a decimal: ${value}`);
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
  const units = BigInt(whole + fraction);
  return { units: negative ? -units : units, scale: fraction.length };
}

function rescale(value: Scaled, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

function format({ units, scale }: Scaled): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale ? `.${digits.slice(digits.length - scale)}` : "";
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

export function add(a: string, b: string): string {
  const x = parse(a);
  const y = parse(b);
  const scale = Math.max(x.scale, y.scale);
  return format({ units: rescale(x, scale) + rescale(y, scale), scale });
}

export function negate(value: string): string {
  const x = parse(value);
  return format({ units: -x.units, scale: x.scale });
}

export function isZero(value: string): boolean {
  return parse(value).units === 0n;
}

export function isNegative(value: string): boolean {
  return parse(value).units < 0n;
}

/** For display: thousands separators, and a symbol for the common currencies. */
export function formatMoney(number: string, currency: string): string {
  const negative = isNegative(number);
  const [whole = "0", fraction] = number.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const digits = fraction ? `${grouped}.${fraction}` : grouped;
  const symbol = SYMBOLS[currency];
  const body = symbol ? `${symbol}${digits}` : `${digits} ${currency}`;
  return negative ? `−${body}` : body;
}

const SYMBOLS: Record<string, string> = {
  USD: "$",
  CAD: "$",
  AUD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

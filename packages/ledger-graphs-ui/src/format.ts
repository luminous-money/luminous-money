/** Money for labels: whole units ("$6,092"), with cents, or compact for axes ("$16K"). */
export type MoneyFormat = (n: number, style?: "whole" | "cents" | "compact") => string;

export function moneyFormat(currency: string, locale?: string): MoneyFormat {
  const make = (options: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat(locale, { style: "currency", currency, ...options });
  const whole = make({ maximumFractionDigits: 0 });
  const cents = make({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const compact = make({ notation: "compact", maximumFractionDigits: 1 });
  return (n, style = "whole") =>
    (style === "cents" ? cents : style === "compact" ? compact : whole).format(n);
}

/** A month (YYYY-MM) as "Oct", or "Oct '25" with the year. */
export function monthLabel(month: string, withYear = false, locale?: string): string {
  const date = new Date(`${month}-01T00:00:00Z`);
  const name = date.toLocaleDateString(locale, { month: "short", timeZone: "UTC" });
  return withYear ? `${name} '${month.slice(2, 4)}` : name;
}

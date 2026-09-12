import { Decimal } from "decimal.js";
import { estimate, unknown, type Evidence } from "./evidence.ts";
import { isIsoDay } from "./iso-day.ts";
type SalesDay = {
  readonly date: string;
  readonly estimatedUnitsSold: Evidence<number>;
  readonly lastKnownPrice: Evidence<number>;
};
export function estimateThirtyDaySales(
  days: readonly SalesDay[],
  period: { startDate: string; endDate: string },
  source: { sourceId: string; observedAt: string },
): { units30d: Evidence<number>; revenue30d: Evidence<string> } {
  const unavailable = () => ({
    units30d: unknown("SALES_PERIOD_INCOMPLETE", source.sourceId),
    revenue30d: unknown("SALES_PERIOD_INCOMPLETE", source.sourceId),
  });
  if (
    !isIsoDay(period.startDate) ||
    !isIsoDay(period.endDate) ||
    days.some((day) => !isIsoDay(day.date))
  )
    return unavailable();
  const span =
    (Date.parse(period.endDate) - Date.parse(period.startDate)) / 86400000 + 1;
  if (
    span !== 30 ||
    days.length !== 30 ||
    new Set(days.map((day) => day.date)).size !== 30 ||
    days.some((day) => day.date < period.startDate || day.date > period.endDate)
  )
    return unavailable();
  let units = new Decimal(0),
    revenue = new Decimal(0),
    pricesKnown = true;
  for (const day of days) {
    if (
      day.estimatedUnitsSold.kind === "unknown" ||
      !Number.isSafeInteger(day.estimatedUnitsSold.value) ||
      day.estimatedUnitsSold.value < 0
    )
      return unavailable();
    units = units.plus(day.estimatedUnitsSold.value);
    if (
      day.lastKnownPrice.kind === "unknown" ||
      !Number.isFinite(day.lastKnownPrice.value) ||
      day.lastKnownPrice.value <= 0 ||
      new Decimal(day.lastKnownPrice.value).decimalPlaces() > 2
    )
      pricesKnown = false;
    else
      revenue = revenue.plus(
        new Decimal(day.lastKnownPrice.value).times(
          day.estimatedUnitsSold.value,
        ),
      );
  }
  if (units.gt(Number.MAX_SAFE_INTEGER)) return unavailable();
  return {
    units30d: estimate(units.toNumber(), source.sourceId, source.observedAt),
    revenue30d:
      pricesKnown && revenue.times(100).lte(Number.MAX_SAFE_INTEGER)
        ? estimate(revenue.toFixed(2), source.sourceId, source.observedAt)
        : unknown("DAILY_PRICE_UNKNOWN", source.sourceId),
  };
}

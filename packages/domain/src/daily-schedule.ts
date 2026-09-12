import { z } from "zod";
const time = z
  .string()
  .regex(/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/)
  .nullish();
const scheduleSettings = z.object({
  timezone: z.string().min(1),
  researchStartLocalTime: time,
  summaryLocalTime: time,
});
export type DailyScheduleKind = "research" | "summary";
export type DailySchedule = {
  localDate: string;
  timezone: string;
  due: DailyScheduleKind[];
  unconfigured: DailyScheduleKind[];
};
export function dueDailySchedules(
  now: Date,
  snapshot: unknown,
): DailySchedule | null {
  const parsed = scheduleSettings.safeParse(snapshot);
  if (!parsed.success || !Number.isFinite(now.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: parsed.data.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)?.value;
    const year = get("year"),
      month = get("month"),
      day = get("day"),
      hour = get("hour"),
      minute = get("minute");
    if (!year || !month || !day || !hour || !minute) return null;
    const localTime = hour + ":" + minute,
      due: DailyScheduleKind[] = [],
      unconfigured: DailyScheduleKind[] = [];
    const slots: readonly [DailyScheduleKind, string | null | undefined][] = [
      ["research", parsed.data.researchStartLocalTime],
      ["summary", parsed.data.summaryLocalTime],
    ];
    for (const [kind, scheduled] of slots) {
      if (scheduled == null) unconfigured.push(kind);
      else if (localTime >= scheduled) due.push(kind);
    }
    return {
      localDate: year + "-" + month + "-" + day,
      timezone: parsed.data.timezone,
      due,
      unconfigured,
    };
  } catch {
    return null;
  }
}

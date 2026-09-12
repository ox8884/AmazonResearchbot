const retryAgainAtPattern =
  /retry\s+again\s+at\s*[:=]?\s*(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2))/gi;

function nestedStrings(value: unknown, depth = 0): readonly string[] {
  if (depth > 6) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.flatMap((item) => nestedStrings(item, depth + 1));
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap((item) => nestedStrings(item, depth + 1));
}

function validDate(value: string): Date | null {
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : new Date(milliseconds);
}

function retryAfterDate(value: string | null, now: Date): Date | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isSafeInteger(seconds)
      ? new Date(now.getTime() + seconds * 1_000)
      : null;
  }
  return validDate(trimmed);
}

function retryAgainAtDate(body: unknown): Date | null {
  let latest: Date | null = null;
  for (const text of nestedStrings(body)) {
    for (const match of text.matchAll(retryAgainAtPattern)) {
      const candidateText = match[1];
      if (candidateText === undefined) continue;
      const candidate = validDate(candidateText);
      if (candidate !== null && (latest === null || candidate > latest))
        latest = candidate;
    }
  }
  return latest;
}

export function retryNotBefore(input: {
  readonly retryNumber: number;
  readonly retryAfter: string | null;
  readonly body: unknown;
  readonly now: Date;
}): Date {
  const fallbackMilliseconds = input.retryNumber === 1 ? 5_000 : 30_000;
  let latest = new Date(input.now.getTime() + fallbackMilliseconds);
  const retryAfter = retryAfterDate(input.retryAfter, input.now);
  const retryAgainAt = retryAgainAtDate(input.body);
  for (const candidate of [retryAfter, retryAgainAt]) {
    if (candidate !== null && candidate > latest) latest = candidate;
  }
  return latest;
}

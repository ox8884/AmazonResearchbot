export function normalizeKeyword(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

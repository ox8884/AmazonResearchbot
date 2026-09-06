export type SalesRow = {
  asin: string;
  parentAsin: string | null;
  isVariant: boolean;
  revenue: string;
};

export type FamilyRevenue =
  | { kind: "known"; total: string; families: number }
  | { kind: "unknown"; reason: string };

function addDecimal(a: string, b: string): string {
  const [ai, af = ""] = a.split(".");
  const [bi, bf = ""] = b.split(".");
  const scale = Math.max(af.length, bf.length);
  const av = BigInt(ai + af.padEnd(scale, "0"));
  const bv = BigInt(bi + bf.padEnd(scale, "0"));
  const sum = av + bv;
  const s = sum.toString().padStart(scale + 1, "0");
  if (scale === 0) return s;
  return `${s.slice(0, s.length - scale)}.${s.slice(s.length - scale)}`;
}

export function foldParentRevenue(rows: SalesRow[]): FamilyRevenue {
  const familyRevenue: Record<string, string> = {};
  for (const row of rows) {
    const parent = row.parentAsin ?? (row.isVariant ? null : row.asin);
    if (parent == null || parent === "") {
      return { kind: "unknown", reason: "variant without parent family" };
    }
    if (familyRevenue[parent] == null) familyRevenue[parent] = row.revenue;
  }
  const keys = Object.keys(familyRevenue);
  let total = "0";
  for (const key of keys) {
    const value = familyRevenue[key];
    if (value == null) continue;
    total = addDecimal(total, value);
  }
  return { kind: "known", total, families: keys.length };
}

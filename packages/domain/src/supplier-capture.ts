import { z } from "zod";

const sourceUrl = z.string().max(2048).url().regex(new RegExp("^https://(?:[a-z0-9-]+\\.)*alibaba\\.com(?:/[^?#]*)?(?:\\?[^#]*)?$", "i"));
const field = z.object({
  value: z.string().trim().min(1).max(1000),
  excerpt: z.string().min(1).max(2000),
}).strict().nullable();
export const supplierCaptureSchema = z.object({
  candidateId: z.string().uuid(),
  specId: z.string().uuid(),
  inputVersion: z.number().int().positive(),
  settingsVersion: z.number().int().positive(),
  searchQuery: z.string().trim().min(1).max(500),
  companyUrl: sourceUrl,
  productUrl: sourceUrl,
  observedAt: z.string().datetime({ offset: true }),
  pageText: z.string().min(1).max(100_000),
  companyName: z.string().trim().min(1).max(300),
  email: z.string().email().max(320).nullable(),
  observedSpec: z.object({
    material: field, dimensions: field, packaging: field, requirements: field,
  }).strict(),
}).strict().superRefine((capture, context) => {
  const source = capture.pageText;
  if (!source.includes(capture.companyName) ||
      (capture.email !== null && !source.split(/[\s<>"(),;:]+/).includes(capture.email))) {
    context.addIssue({ code: "custom", message: "Supplier contact lacks page evidence" });
  }
  for (const evidence of Object.values(capture.observedSpec)) {
    if (evidence && (!source.includes(evidence.excerpt) || !evidence.excerpt.includes(evidence.value))) {
      context.addIssue({ code: "custom", message: "Specification lacks page evidence" });
    }
  }
});

export type SupplierCapture = z.infer<typeof supplierCaptureSchema>;
export function compareCapturedSpec(
  capture: SupplierCapture,
  requested: Readonly<Record<keyof SupplierCapture["observedSpec"], string>>,
): "matches" | "unknown" {
  const labels: Readonly<Record<keyof SupplierCapture["observedSpec"], readonly string[]>> = {
    material: ["material", "재질"], dimensions: ["dimensions", "product dimensions", "product size", "제품 크기", "제품 치수"],
    packaging: ["packaging", "포장"], requirements: ["requirements", "요구사항", "품질 요구사항"],
  };
  const page = "\n" + capture.pageText.split(/\r?\n/).map(line => line.trim()).join("\n") + "\n";
  for (const key of ["material", "dimensions", "packaging", "requirements"] as const) {
    // Text differences are not proof of a mismatch; semantic review remains necessary.
    const evidence = capture.observedSpec[key];
    if (!evidence || evidence.value.trim() !== requested[key].trim()) return "unknown";
    const excerpt = evidence.excerpt.replace(/\r\n/g, "\n").trim();
    const parts = /^([^\n:]+)(?:: |\n)([\s\S]+)$/.exec(excerpt);
    const label = parts?.[1]?.trim().toLowerCase(), value = parts?.[2]?.trim();
    if (!labels[key].some(expected => expected === label) || value !== evidence.value.trim() || !page.includes("\n" + excerpt + "\n")) return "unknown";
  }
  return "matches";
}

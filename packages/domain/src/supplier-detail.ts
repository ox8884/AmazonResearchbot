import { z } from "zod";
import { supplierCaptureSchema, type SupplierCapture } from "./supplier-capture.ts";

export const supplierProductUrlPattern = /^https:\/\/www\.alibaba\.com\/product-detail\/[^\s/?#]+\.html(?:\?[^#]*)?$/;
export const supplierCompanyUrlPattern = /^https:\/\/[a-z0-9-]+\.(?:m\.)?(?:en|trustpass)\.alibaba\.com(?:[/?][^#]*)?$/;
export const supplierDetailProductUrlSchema = supplierCaptureSchema.shape.productUrl.regex(supplierProductUrlPattern);
export const supplierDetailCompanyUrlSchema = supplierCaptureSchema.shape.companyUrl.regex(supplierCompanyUrlPattern);

export const supplierDetailObservationSchema = z.object({
  protocol: z.literal(1), kind: z.literal("captured"), scope: z.literal("supplier_product_page"),
  sourcePageUrl: supplierDetailProductUrlSchema,
  companyUrl: supplierDetailCompanyUrlSchema,
  companyName: z.string().trim().min(1).max(300), productName: z.string().trim().min(1).max(2000),
  observedAt: z.string().datetime({ offset: true }), snapshot: z.string().min(1).max(2_000_000),
  pageText: z.string().min(1).max(100_000),
  attributes: z.array(z.object({
    label: z.string().trim().min(1).max(100), value: z.string().trim().min(1).max(1000),
    excerpt: z.string().min(1).max(2000),
  }).strict()).min(1).max(100),
}).strict().superRefine((value, context) => {
  if (!value.pageText.includes(value.companyName) || !value.pageText.includes(value.productName))
    context.addIssue({ code: "custom", message: "Product and seller lack page evidence" });
  for (const field of value.attributes) {
    if (!value.pageText.includes(field.excerpt) || !field.excerpt.includes(field.label) || !field.excerpt.includes(field.value))
      context.addIssue({ code: "custom", message: "Attribute lacks page evidence" });
  }
});
export type SupplierDetailObservation = z.infer<typeof supplierDetailObservationSchema>;

export function supplierDetailCapture(observation: SupplierDetailObservation, scope: {
  readonly candidateId: string; readonly specId: string; readonly inputVersion: number;
  readonly settingsVersion: number; readonly searchQuery: string;
}): SupplierCapture {
  const field = (labels: readonly string[]) => {
    const matches = observation.attributes.filter(row => labels.includes(row.label.toLowerCase()));
    const row = matches.length === 1 ? matches[0] : undefined;
    if (!row || (row.excerpt !== row.label + "\n" + row.value && row.excerpt !== row.label + ": " + row.value)) return null;
    return { value: row.value, excerpt: row.excerpt };
  };
  const email = field(["email", "e-mail", "이메일"]);
  const parsedEmail = supplierCaptureSchema.shape.email.safeParse(email?.value ?? null);
  return { ...scope, companyUrl: observation.companyUrl, productUrl: observation.sourcePageUrl,
    companyName: observation.companyName, observedAt: observation.observedAt, pageText: observation.pageText,
    email: parsedEmail.success ? parsedEmail.data : null,
    observedSpec: {
      material: field(["material", "재질"]),
      // Package dimensions and unselected size variants do not establish product dimensions.
      dimensions: field(["product dimensions", "product size", "제품 크기", "제품 치수"]),
      packaging: field(["packaging", "포장"]), requirements: field(["requirements", "요구사항", "품질 요구사항"]),
    },
  };
}

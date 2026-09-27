// Live check of the Jev shadow-mode question wording against hand-labelled synthetic cases.
// pnpm exec tsx --env-file=.env scripts/verify-jev-questions.ts
import { askJev } from "@forge-ops/integrations/jev";
import { differentiationRequest, inboxRfqRequest, specMatchRequest } from "../apps/worker/src/jev-shadow.ts";

const apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) throw new Error("TYPESAFE_API_KEY missing");
type Choice = { choice: string; confidence: number };
let agree = 0, total = 0;
function check(label: string, got: string, confidence: number, want: string) {
  total++; if (got === want) agree++;
  console.log(`${got === want ? "✓" : "✗"} ${label.padEnd(34)} jev=${got.padEnd(8)} want=${want.padEnd(8)} conf=${confidence.toFixed(2)}`);
}
const field = (excerpt: string) => ({ value: excerpt.split(": ")[1] ?? excerpt, excerpt });

const specCases = [
  {
    name: "garlic press", spec: { material: "304 stainless steel", dimensions: "18 x 4 x 3 cm", packaging: "individual color box", requirements: "FDA food-contact compliant" },
    page: "Garlic Press Heavy Duty\nMaterial: SUS304 stainless steel\nSize: 7.1 x 1.6 x 1.2 inch\nPacking: 50 pcs per polybag, bulk export carton\nMOQ 500 pcs",
    observed: { material: field("Material: SUS304 stainless steel"), dimensions: field("Size: 7.1 x 1.6 x 1.2 inch"), packaging: field("Packing: 50 pcs per polybag, bulk export carton"), requirements: null },
    want: { material: "match", dimensions: "match", packaging: "mismatch", requirements: "unclear" },
  },
  {
    name: "spatula set", spec: { material: "BPA-free food-grade silicone", dimensions: "28 cm length", packaging: "individual color box", requirements: "LFGB certified" },
    page: "Kitchen Spatula Set\nMaterial: PP plastic handle, nylon head\nCustomized size accepted\nOEM packaging: custom color box available\nCertificates: LFGB, FDA",
    observed: { material: field("Material: PP plastic handle, nylon head"), dimensions: field("Customized size accepted"), packaging: field("OEM packaging: custom color box available"), requirements: field("Certificates: LFGB, FDA") },
    want: { material: "mismatch", dimensions: "match", packaging: "match", requirements: "match" },
  },
];
for (const c of specCases) {
  const r = await askJev(apiKey, specMatchRequest(c.spec, { companyName: "Test Supplier", pageText: c.page, observedSpec: c.observed }));
  for (const [f, want] of Object.entries(c.want)) { const a = r.answers[f] as Choice; check(`spec ${c.name} / ${f}`, a.choice, a.confidence, want); }
}

const review = (text: string, i: number) => ({ ref: `review:R${"ABCDE" + i}`, kind: "review" as const, text });
const diffCases = [
  { name: "press breaks", want: true, reviews: ["Handle bent after one month of use.", "The hinge snapped the second time I pressed ginger.", "Flimsy aluminum, broke within weeks.", "Works but feels cheap, the handle flexes a lot."] },
  { name: "all happy", want: false, reviews: ["Works great, love it.", "Good value for the price.", "Exactly as described, happy.", "Nice gift for my mom."] },
  { name: "scattered", want: false, reviews: ["Arrived two days late.", "Color is a bit darker than the photo.", "Great product.", "Box was dented but item fine."] },
];
for (const c of diffCases) {
  const r = await askJev(apiKey, differentiationRequest("kitchen tool", c.reviews.map(review)));
  const p = (r.answers.differentiation as { noul: number }).noul;
  check(`diff ${c.name}`, String(p >= 0.5), Math.max(p, 1 - p), String(c.want));
}

const rfqs = [
  { id: "a", supplier: "Ningbo Kitchenware", recipient: "sales@nbkw.com", subject: "RFQ: silicone spatula set 1000 pcs", keyword: "silicone spatula set" },
  { id: "b", supplier: "Yangjiang Blade Co", recipient: "amy@yjblade.cn", subject: "RFQ: stainless garlic press", keyword: "garlic press" },
];
const inboxCases = [
  { name: "garlic quote", want: "rfq_2", from: "amy@yjblade.cn", subject: "Re: quotation", body: "Dear friend, for the 304 garlic press our price is USD 1.85/pc, MOQ 1000, lead time 25 days." },
  { name: "spatula other addr", want: "rfq_1", from: "lisa@nbkw-trade.com", subject: "your inquiry", body: "Hello, about your silicone spatula inquiry: unit price 0.95 USD, food grade silicone, color box +0.10." },
  { name: "newsletter", want: "none", from: "deals@alibaba.com", subject: "Weekly top deals", body: "Discover this week's trending products and exclusive coupons." },
];
for (const c of inboxCases) {
  const { request } = inboxRfqRequest(c, rfqs);
  const a = (await askJev(apiKey, request)).answers.rfq as Choice;
  check(`inbox ${c.name}`, a.choice, a.confidence, c.want);
}
console.log(`\nagreement ${agree}/${total}`);
if (agree < total) process.exitCode = 1;

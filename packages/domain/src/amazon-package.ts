import { z } from 'zod';
import { measured, unknown, type Evidence } from './evidence.ts';
import type { PackagedMeasurements } from './standard-size.ts';
import {amazonProductEvidenceSchema} from './amazon-product-evidence.ts';

const amazonProductUrlPattern = /^https:\/\/(?:www\.)?amazon\.com\/(?:[A-Za-z0-9_-]+\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})(?:\/(?:ref=[A-Za-z0-9_=.-]+)?)?(?:\?[^#\s\\]*)?(?:#[^\s\\]*)?$/;

const pageMeasurements = z.object({
  sourcePageUrl: z.string().url().max(4096),
  observedAt: z.iso.datetime({ offset: true }),
  rows: z.array(z.object({label:z.string().trim().max(100),value:z.string().trim().max(2000)}).strict()).max(100),
}).strict();
function packagePounds(text: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(pounds?|lbs?|ounces?|oz)$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  const pounds = /^(ounces?|oz)$/.test(match[2] ?? '') ? value / 16 : value;
  return Number.isFinite(pounds) && pounds > 0 ? pounds : null;
}

export function parseAmazonPackageMeasurements(asin: string, observation: unknown): Evidence<PackagedMeasurements> {
  const parsed = pageMeasurements.safeParse(observation);
  if (!parsed.success || !/^[A-Z0-9]{10}$/.test(asin)) return unknown('AMAZON_PACKAGE_SOURCE_INVALID');
  const {sourcePageUrl,observedAt,rows} = parsed.data;
  const pageAsin = amazonProductUrlPattern.exec(sourcePageUrl)?.[1];
  if (pageAsin !== asin)
    return unknown('REPRESENTATIVE_ASIN_MISMATCH', sourcePageUrl);
  const values = (label: string) => [...new Set(rows.filter(row => row.label.toLowerCase() === label)
    .map(row => row.value.replace(/[\u200e\u200f\u202a-\u202e]/g,'').trim().toLowerCase()))];
  const identifiers = values('asin');
  if (identifiers.length !== 1 || identifiers[0] !== asin.toLowerCase()) return unknown('REPRESENTATIVE_ASIN_MISMATCH', sourcePageUrl);
  const dimensions = values('package dimensions');
  if (dimensions.length !== 1) return unknown(dimensions.length ? 'CONFLICTING_PACKAGE_MEASUREMENTS' : 'PACKAGE_DIMENSIONS_UNKNOWN', sourcePageUrl);
  const match = /^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:inches|inch|in)\s*(?:;\s*(.+))?$/.exec(dimensions[0] ?? '');
  if (!match) return unknown('PACKAGE_DIMENSIONS_UNKNOWN', sourcePageUrl);
  const length=Number(match[1]),width=Number(match[2]),height=Number(match[3]);
  if (![length,width,height].every(value => Number.isFinite(value) && value > 0)) return unknown('PACKAGE_DIMENSIONS_UNKNOWN',sourcePageUrl);
  const weights = values('package weight');
  if (weights.length > 1) return unknown('CONFLICTING_PACKAGE_MEASUREMENTS', sourcePageUrl);
  const combined = match[4] === undefined ? null : packagePounds(match[4]);
  const separate = weights[0] === undefined ? null : packagePounds(weights[0]);
  if ((match[4] !== undefined && combined === null) || (weights.length === 1 && separate === null)) return unknown('PACKAGE_WEIGHT_UNKNOWN',sourcePageUrl);
  if (combined !== null && separate !== null && combined !== separate) return unknown('CONFLICTING_PACKAGE_MEASUREMENTS',sourcePageUrl);
  const pounds = combined ?? separate;
  if (pounds === null) return unknown('PACKAGE_WEIGHT_UNKNOWN', sourcePageUrl);
  return measured<PackagedMeasurements>({
    asin,marketplace:'us',basis:'packaged_unit',
    dimensions:{length,width,height,unit:'inches'},weight:{value:pounds,unit:'pounds'},
  },sourcePageUrl,new Date(observedAt).toISOString());
}

export const amazonPackageObservationSchema = pageMeasurements.extend({
  protocol: z.literal(1), kind: z.literal('captured'), scope: z.literal('amazon_product_page'),
  asin: z.string().regex(/^[A-Z0-9]{10}$/),
  productEvidence:amazonProductEvidenceSchema.optional(),
  snapshot: z.string().min(1).max(2_000_000), pageText: z.string().min(1).max(100_000),
  rows: z.array(pageMeasurements.shape.rows.element.extend({excerpt:z.string().min(1).max(2200)}).strict()).min(1).max(100),
}).strict().superRefine((value,context) => {
  const identifiers = value.rows.filter(row=>row.label==='ASIN');
  if (amazonProductUrlPattern.exec(value.sourcePageUrl)?.[1] !== value.asin || !identifiers.length || identifiers.some(row=>row.value!==value.asin))
    context.addIssue({code:'custom',message:'Exact product identity is required'});
  for (const row of value.rows) {
    if (!value.pageText.includes(row.excerpt) || row.excerpt !== row.label+' '+row.value)
      context.addIssue({code:'custom',message:'Row lacks matching page evidence'});
  }
});

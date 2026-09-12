import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { measured, unknown, type Evidence } from './evidence.ts';

export const STANDARD_SIZE_POLICY = {
  id: 'amazon-us-2026-01-15',
  effectiveFrom: '2026-01-15',
  sourceUrl: 'https://sellercentral.amazon.com/help/hub/reference/GG5KW835AHDJCH8W',
  dimensionalWeightSourceUrl: 'https://sellercentral.amazon.com/help/hub/reference/G53Z9EKF8VVZVH29',
} as const;

const packagedMeasurements = z.object({
  asin: z.string().regex(/^[A-Z0-9]{10}$/),
  marketplace: z.literal('us'),
  basis: z.literal('packaged_unit'),
  dimensions: z.object({
    length: z.number().finite().positive(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    unit: z.literal('inches'),
  }).strict(),
  weight: z.object({ value: z.number().finite().positive(), unit: z.literal('pounds') }).strict(),
}).strict();
export type PackagedMeasurements = z.infer<typeof packagedMeasurements>;
const sourceStamp = z.object({ sourceId: z.string().trim().min(1), observedAt: z.iso.datetime({ offset: true }) });

export function assessStandardSize(selectedAsin: string | null, observation: Evidence<unknown>): Evidence<boolean> {
  if (!selectedAsin) return unknown('REPRESENTATIVE_ASIN_REQUIRED', observation.sourceId);
  if (observation.kind !== 'measured') return unknown('PACKAGED_MEASUREMENTS_UNCONFIRMED', observation.sourceId);
  const source = sourceStamp.safeParse(observation);
  const parsed = packagedMeasurements.safeParse(observation.value);
  if (!source.success || !parsed.success) return unknown('PACKAGED_MEASUREMENTS_UNCONFIRMED', observation.sourceId);
  if (parsed.data.asin !== selectedAsin) return unknown('REPRESENTATIVE_ASIN_MISMATCH', observation.sourceId);
  const { dimensions, weight } = parsed.data;
  const sides: [number, number, number] = [dimensions.length, dimensions.width, dimensions.height];
  sides.sort((a, b) => b - a);
  const [longest, median, shortest] = sides;
  const dimensionalWeight = new Decimal(longest).mul(median).mul(shortest).div(139);
  const shippingWeight = Decimal.max(weight.value, dimensionalWeight);
  const standard = longest <= 18 && median <= 14 && shortest <= 8 && shippingWeight.lte(20);
  return measured(standard, source.data.sourceId, new Date(source.data.observedAt).toISOString());
}

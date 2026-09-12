import {z} from 'zod';

const reviewSchema=z.object({
  id:z.string().regex(/^R[A-Z0-9]{5,30}$/),
  title:z.string().trim().min(1).max(2000),
  bodyExcerpt:z.string().trim().min(1).max(12000),
  ratingText:z.string().regex(/^[1-5](?:\.0)? out of 5 stars$/).nullable(),
  variantLabel:z.string().trim().min(1).max(1000).nullable(),
  variantPath:z.string().regex(/^\/portal\/customer-reviews\/[A-Z0-9]{10}$/).nullable(),
  reviewedAsin:z.string().regex(/^[A-Z0-9]{10}$/).nullable(),
}).strict().refine(row=>row.reviewedAsin===(row.variantPath?.split('/').at(-1)??null),{
  message:'Review variant identity must come from its observed product link',
});

/** Listing claims and sampled review text are source material, not verified product performance. */
export const amazonProductEvidenceSchema=z.object({
  basis:z.literal('listing_claims_and_review_excerpts'),
  title:z.string().trim().min(1).max(2000).nullable(),
  claims:z.array(z.string().trim().min(1).max(4000)).max(20),
  reviews:z.array(reviewSchema).max(20),
}).strict().refine(value=>new Set(value.reviews.map(row=>row.id)).size===value.reviews.length,{
  message:'Each observed review must have a distinct source identity',
});

export const productSourceViewSchema=z.union([
  z.object({state:z.enum(['not_selected','not_collected','stale','collecting','waiting','legacy'])}).strict(),
  z.object({state:z.literal('captured'),asin:z.string().regex(/^[A-Z0-9]{10}$/),
    observedAt:z.iso.datetime({offset:true}),sourcePageUrl:z.string().regex(/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}$/),
    productEvidence:amazonProductEvidenceSchema,
  }).strict().refine(value=>value.sourcePageUrl.endsWith('/'+value.asin)),
]);
export type ProductSourceView=z.infer<typeof productSourceViewSchema>;

export type AiProductExcerpt = {readonly ref:string;readonly kind:'claim'|'review';readonly text:string};
const privateExcerpt = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]|https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d ().-]{7,}\d|\b(?:my name is|contact me|my address|my phone|my email)\b|\b\d{1,6}\s+[a-z ]+\s(?:street|road|avenue|lane|drive|st|rd|ave)\b/i;
function shortProductExcerpt(value:string):string|null {
 if(privateExcerpt.test(value))return null;
 const words=[...value.matchAll(/\S+/g)].slice(0,25),last=words.at(-1);
 if(!last)return null;
 const text=value.slice(words[0]?.index??0,last.index+last[0].length);
 return text.length<=400&&!/[A-Za-z0-9_=-]{40,}/.test(text)?text:null;
}
export function selectAiProductExcerpts(asin:string,source:z.infer<typeof amazonProductEvidenceSchema>):readonly AiProductExcerpt[]{
 const claims=source.claims.flatMap((value,index)=>{
  const text=shortProductExcerpt(value);
  return text?[{ref:'claim:'+index,kind:'claim' as const,text}]:[];
 }).slice(0,6);
 const reviews=source.reviews.flatMap(row=>{
  if(row.reviewedAsin!==asin)return [];
  const text=shortProductExcerpt(row.bodyExcerpt);
  return text?[{ref:'review:'+row.id,kind:'review' as const,text}]:[];
 }).slice(0,4);
 return [...claims,...reviews];
}
export const aiProductSourceReferenceSchema=z.object({
 version:z.literal(1),receiptId:z.uuid(),bodySha256:z.string().regex(/^[a-f0-9]{64}$/),
 asin:z.string().regex(/^[A-Z0-9]{10}$/),inputVersion:z.number().int().positive(),settingsVersion:z.number().int().positive(),
 fragments:z.array(z.object({ref:z.string().regex(/^(?:claim:\d+|review:R[A-Z0-9]{5,30})$/),kind:z.enum(['claim','review']),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()
  .refine(row=>row.ref.startsWith(row.kind+':'))).max(10),
}).strict().refine(source=>new Set(source.fragments.map(row=>row.ref)).size===source.fragments.length);
export type AiProductSourceReference=z.infer<typeof aiProductSourceReferenceSchema>;

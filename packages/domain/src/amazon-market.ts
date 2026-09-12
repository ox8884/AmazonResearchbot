import {z} from 'zod';
import {measured,unknown,type Evidence} from './evidence.ts';

const asin=z.string().regex(/^[A-Z0-9]{10}$/);
export const amazonMarketObservationSchema=z.object({
 protocol:z.literal(1),kind:z.literal('captured'),scope:z.literal('amazon_search_first_page'),
 query:z.string().trim().min(1).max(500),marketplace:z.literal('us'),sort:z.literal('featured'),
 sourcePageUrl:z.string().url().max(4096),observedAt:z.string().datetime({offset:true}),
 rangeText:z.string().min(1).max(2000),rangeEnd:z.number().int().positive().max(200),
 coverage:z.enum(['complete','partial']),snapshot:z.string().min(1).max(1000000),
 slots:z.array(z.object({
  position:z.number().int().positive().max(200),asin:asin.nullable(),title:z.string().min(1).max(2000).nullable(),
  productUrl:z.string().url().max(100).nullable(),
  imageUrl:z.string().url().max(3000).regex(/^https:\/\/m\.media-amazon\.com\/images\/[^?#\s\\]+$/).nullable(),
  adStatus:z.enum(['sponsored','not_marked','unknown']),
  priceTexts:z.array(z.string().min(1).max(100)).max(20),sourceText:z.string().min(1).max(30000),
 }).strict()).min(1).max(200),
}).strict().superRefine((value,context)=>{
 const error=(message:string)=>context.addIssue({code:'custom',message});
 if(!/^https:\/\/www\.amazon\.com\/s(?:\/ref=[A-Za-z0-9_-]+)?\?[^#\s\\]+$/.test(value.sourcePageUrl))error('Search source URL is invalid');
 if(!value.rangeText.includes(value.query)||!new RegExp('^1[-–]'+value.rangeEnd+'\\s').test(value.rangeText))error('First-page range is not confirmed');
 for(const [index,slot] of value.slots.entries()){
  if(slot.position!==index+1)error('Slot order must be preserved');
  if(slot.productUrl!==null&&(slot.asin===null||slot.productUrl!=='https://www.amazon.com/dp/'+slot.asin))error('Product identity differs');
  if(slot.title!==null&&!slot.sourceText.includes(slot.title))error('Title source is missing');
  if(slot.priceTexts.some(price=>!slot.sourceText.includes(price)))error('Price source is missing');
 }
 const unmarked=value.slots.filter(slot=>slot.adStatus==='not_marked');
 const complete=unmarked.length===value.rangeEnd&&unmarked.every(slot=>slot.asin!==null&&slot.title!==null)&&value.slots.every(slot=>slot.adStatus!=='unknown');
 if((value.coverage==='complete')!==complete)error('Coverage does not match observed slots');
});
export type AmazonMarketObservation=z.infer<typeof amazonMarketObservationSchema>;

export function observedListingPrice(prices:readonly string[],source:{sourceId:string;observedAt:string}):Evidence<string>{
 const unique=[...new Set(prices)];
 if(unique.length!==1)return unknown(unique.length?'MULTIPLE_DISPLAYED_PRICES':'LISTING_PRICE_NOT_VISIBLE',source.sourceId);
 const match=/^\$((?:\d+|\d{1,3}(?:,\d{3})+)\.\d{2})$/.exec(unique[0]??'');
 if(!match?.[1])return unknown('LISTING_CURRENCY_OR_PRICE_UNCONFIRMED',source.sourceId);
 const value=match[1].replaceAll(',','');
 if(!Number.isFinite(Number(value))||Number(value)<=0)return unknown('LISTING_PRICE_INVALID',source.sourceId);
 return measured(value,source.sourceId,source.observedAt);
}

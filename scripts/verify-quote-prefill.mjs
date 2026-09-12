import assert from 'node:assert/strict';
import {createElement} from '../apps/web/node_modules/react/index.js';
import {renderToStaticMarkup} from '../apps/web/node_modules/react-dom/server.node.js';
import {MemoryRouter} from '../apps/web/node_modules/react-router/dist/development/index.mjs';
import {QuoteForm} from '../apps/web/src/QuoteForm.tsx';
const observedAt='2026-09-06T12:00:00.000Z';
const prefill={inboxMessageId:'source-message',candidateId:'candidate',specId:'spec',bound:true,complete:false,supplierName:'Synthetic vendor',supplierSource:'Supplier email reply',sourceText:'Product unit price: USD 5.00',operatorEvidence:'Operator fee reference',receivedAt:observedAt,validUntil:null,incoterm:'DDP',quantity:300,moq:100,costs:{productUnitPrice:{kind:'quote',value:'5',source:'USD 5.00',observedAt},unitDuty:{kind:'quote',value:'0',source:'USD 0',observedAt}},issues:[],quote:null};
const markup=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(QuoteForm,{candidateId:'candidate',specId:'spec',prefill,onSaved(){},onCancel(){}})));
const inputs=markup.match(/<input\b[^>]*>/g)??[];
const field=name=>{const input=inputs.find(tag=>tag.includes(`name="${name}"`));assert.ok(input,`Missing input ${name}`);return input;};
assert.ok(field('supplierName').includes('value="Synthetic vendor"'));
assert.ok(field('quantity').includes('value="300"'));assert.ok(/readonly/i.test(field('quantity')));
assert.ok(field('amount-productUnitPrice').includes('value="5"'));assert.ok(/readonly/i.test(field('amount-productUnitPrice')));
assert.ok(field('amount-unitDuty').includes('value="0"'),'An explicit zero remains a quote');
assert.ok(field('amount-fbaFee').includes('value=""'));assert.ok(!/readonly/i.test(field('amount-fbaFee')),'Unconfirmed fees remain empty and editable');
assert.ok(field('kind-productUnitPrice').includes('value="quote"'));
const value=/value="([^"]*)"/.exec(field('receivedAt'))?.[1];assert.ok(value);assert.equal(new Date(value).toISOString(),observedAt,'Local display must preserve the source timestamp');
assert.ok(!markup.includes('type="checkbox" checked'));
console.log('PASS: quoted fields prefill and lock, explicit zero survives, unknown fees stay blank, and source time is preserved.');

assert.ok(markup.includes('Operator fee reference'));
assert.ok(!markup.includes('>Product unit price: USD 5.00</textarea>'),'Supplier original is not editable operator evidence');
assert.ok(/readonly/i.test(field('validUntil')),'Unknown source expiry cannot be invented');
const freight=/<select[^>]*name="kind-unitFreight"[\s\S]*?<\/select>/.exec(markup)?.[0];
assert.ok(freight && /<option value="quote" disabled/.test(freight) && /<option value="measured" disabled/.test(freight),'Unparsed vendor costs cannot become verified supplier claims');
console.log('PASS: operator evidence is separate; source expiry and unparsed vendor evidence types remain protected.');

assert.ok(/readonly/i.test(field('supplierSource')),'Canonical supplier attribution is not editable');

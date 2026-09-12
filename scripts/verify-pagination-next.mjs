import assert from 'node:assert/strict';
import {readJsonApiNext} from '../packages/integrations/src/jungle-scout/pagination.ts';

assert.equal(readJsonApiNext({data:[],links:{next:null}}, 3, 100).kind, 'complete');
assert.equal(readJsonApiNext({data:[{}]}, 3, 100).kind, 'complete');
assert.equal(readJsonApiNext({data:[]}, 100, 100).kind, 'invalid');
assert.equal(readJsonApiNext({data:[],links:{next:'https://developer.junglescout.com/api/product_database_query?marketplace=us&page[cursor]=x'}}, 100, 100).kind, 'next');
assert.equal(readJsonApiNext({links:{next:1}}, 1, 100).kind, 'invalid');
console.log(JSON.stringify({scenario:'pagination-next',result:'PASS',omittedLinksShortPage:'complete',fullPageMissingLinks:'hold'}));

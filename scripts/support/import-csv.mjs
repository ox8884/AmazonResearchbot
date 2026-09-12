import {randomUUID} from 'node:crypto';
export function importCsv(test,filename,bytes){
 const boundary='forge-fixture-'+randomUUID();
 const header=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`);
 const body=Buffer.concat([header,bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
 return test.call('/api/imports',body,{'content-type':`multipart/form-data; boundary=${boundary}`});
}

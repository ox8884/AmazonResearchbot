import { isIP } from 'node:net';
const v4Reserved = [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
  ['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4],
] as const;
function ipv4(address:string):number{return address.split('.').reduce((n,part)=>(n*256)+Number(part),0)>>>0;}
function ipv6(address:string):bigint {
  const sides=address.split('::');const left=(sides[0]??'').split(':').filter(Boolean),right=(sides[1]??'').split(':').filter(Boolean);
  const parts=sides.length===2?[...left,...Array<string>(8-left.length-right.length).fill('0'),...right]:left;
  return parts.reduce((n,part)=>(n<<16n)+BigInt('0x'+part),0n);
}
function inV6(value:bigint,base:string,bits:number):boolean {const shift=BigInt(128-bits);return (value>>shift)===(ipv6(base)>>shift);}
export function isAllowedAddress(address:string):boolean {
  const family=isIP(address);
  if(family===4){const value=ipv4(address);return !v4Reserved.some(([base,bits])=>{const mask=(0xffffffff<<(32-bits))>>>0;return ((value&mask)>>>0)===((ipv4(base)&mask)>>>0);});}
  if(family!==6||address.includes('.')||address.includes('%'))return false;
  const value=ipv6(address);
  return inV6(value,'2000::',3)&&!inV6(value,'2001::',23)&&!inV6(value,'2001:db8::',32)&&!inV6(value,'2002::',16)&&!inV6(value,'3fff::',20);
}

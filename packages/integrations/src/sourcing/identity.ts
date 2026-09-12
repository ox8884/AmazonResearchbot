import { supplierProductUrlPattern, supplierCompanyUrlPattern } from "@forge-ops/domain";

export function alibabaProductKey(value: string): string | null {
  if (value.length > 2048 || !supplierProductUrlPattern.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "www.alibaba.com" || url.username || url.password || url.port || url.hash || !/^\/product-detail\/[^/]+\.html$/.test(url.pathname)) return null;
    for (const key of ["priceId", "spm", "from"]) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.origin + url.pathname + url.search;
  } catch (error) { if (error instanceof TypeError) return null; throw error; }
}

export function alibabaCompanyKey(value: string): string | null {
  if (value.length > 2048 || !supplierCompanyUrlPattern.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
    const match = /^([a-z0-9-]+)\.(?:m\.)?(en|trustpass)\.alibaba\.com$/.exec(url.hostname);
    return match ? `${match[1]}.${match[2]}.alibaba.com` : null;
  } catch (error) { if (error instanceof TypeError) return null; throw error; }
}

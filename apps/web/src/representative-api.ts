export type Representative = {
  readonly inputVersion: number;
  readonly selectedAsin: string | null;
  readonly availableAsins: readonly string[];
  readonly editable: boolean;
  readonly titles?: Readonly<Record<string,string>>;
};
export class RepresentativeError extends Error {
  constructor(readonly code: string) { super(code); }
}
export async function getRepresentative(candidateId: string): Promise<Representative> {
  const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/representative`, {
    credentials: 'include', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new RepresentativeError('LOAD_FAILED');
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null ||
    !('inputVersion' in body) || typeof body.inputVersion !== 'number' || !Number.isSafeInteger(body.inputVersion) || body.inputVersion < 1 ||
    !('selectedAsin' in body) || !(body.selectedAsin === null || (typeof body.selectedAsin === 'string' && /^[A-Z0-9]{10}$/.test(body.selectedAsin))) ||
    !('availableAsins' in body) || !Array.isArray(body.availableAsins) ||
    !('editable' in body) || typeof body.editable !== 'boolean') throw new RepresentativeError('INVALID_RESPONSE');
  const availableAsins: string[] = [];
  for (const asin of body.availableAsins) {
    if (typeof asin !== 'string' || !/^[A-Z0-9]{10}$/.test(asin)) throw new RepresentativeError('INVALID_RESPONSE');
    availableAsins.push(asin);
  }
  const titles:Record<string,string>={};
  if('titles' in body){
    if(typeof body.titles!=='object'||body.titles===null||Array.isArray(body.titles))throw new RepresentativeError('INVALID_RESPONSE');
    for(const [asin,title] of Object.entries(body.titles)){
      if(!availableAsins.includes(asin)||typeof title!=='string'||title.length===0||title.length>2000)throw new RepresentativeError('INVALID_RESPONSE');
      titles[asin]=title;
    }
  }
  return { inputVersion: body.inputVersion, selectedAsin: body.selectedAsin, editable: body.editable, availableAsins,titles };
}
export async function saveRepresentative(candidateId: string, selection: { readonly asin: string; readonly inputVersion: number }): Promise<void> {
  const response = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/representative`, {
    method: 'POST', credentials: 'include', signal: AbortSignal.timeout(15000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(selection),
  });
  if (!response.ok) throw new RepresentativeError(response.status === 409 ? 'CHANGED' : 'SAVE_FAILED');
}

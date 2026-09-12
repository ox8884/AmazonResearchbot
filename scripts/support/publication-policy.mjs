const credentialPatterns=[/fb[dp]_[a-f0-9]{64}/,/cfast_[A-Za-z0-9]{48}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\bgh[pousr]_[A-Za-z0-9]{30,}\b/,/\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/];
const privateRoots=['.omo/','.codex/','data/','apps/web/qa/'];
export function privateSourcePath(name){
 const path=name.replaceAll(String.fromCharCode(92),'/').toLowerCase(),base=path.split('/').at(-1);
 if((base==='.dev.vars'||base.startsWith('.dev.vars.'))&&base!=='.dev.vars.example')return 'Worker secrets file';
 if(privateRoots.some(root=>path.startsWith(root)))return 'local operational artifact';
 if(['.debug-journal.md','implementation_status.md','worker-authority.json'].includes(base))return 'local operational state';
 if((base==='.env'||base.startsWith('.env.')||base.endsWith('.env'))&&!base.endsWith('.env.example'))return 'environment file';
 if(/\.(?:log|fops|dump|pfx|p12|key)$/.test(base))return 'private dump, key or log';
 if(/^docs\/verification-.*-state\.json$/.test(path))return 'runtime verification snapshot';
 return null;
}
export function inspectSource(entry,protectedValues=[]){
 const pathReason=privateSourcePath(entry.path);
 if(pathReason)return [{path:entry.path,reason:pathReason}];
 if(entry.mode==='120000')return [{path:entry.path,reason:'symbolic link needs explicit publication review'}];
 if(protectedValues.some(value=>entry.path.includes(value))||credentialPatterns.some(pattern=>pattern.test(entry.path)))return [{path:entry.path,reason:'credential appears in filename'}];
 const text=entry.content.toString('utf8'),findings=[];
 for(const value of protectedValues){const at=text.indexOf(value);if(at>=0){findings.push({path:entry.path,line:text.slice(0,at).split('\n').length,reason:'matches a local credential value'});break;}}
 for(const pattern of credentialPatterns){const match=pattern.exec(text);if(match){findings.push({path:entry.path,line:text.slice(0,match.index).split('\n').length,reason:'private credential pattern'});break;}}
 return findings;
}
export function redactPublicationText(text,protectedValues=[]){
 let safe=text;
 for(const value of protectedValues)if(value)safe=safe.replaceAll(value,'[redacted]');
 for(const pattern of credentialPatterns)safe=safe.replace(new RegExp(pattern.source,'g'),'[redacted]');
 return safe;
}

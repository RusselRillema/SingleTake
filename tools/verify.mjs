import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readdir} from 'node:fs/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
const tests=(await readdir(new URL('../tests/',import.meta.url))).filter(f=>f.endsWith('.test.mjs')).sort().map(f=>'tests/'+f);
for(const args of [['--test',...tests],['tools/check.mjs'],['tools/audit.mjs'],['tools/build.mjs']]){
 const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit'});if(result.error){console.error(result.error.message);process.exit(1);}if(result.status!==0)process.exit(result.status||1);
}
console.log('Local checks and static artifact build passed. Real GPU execution and remote deployment are separate checks.');

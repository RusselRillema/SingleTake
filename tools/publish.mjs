/** Explicit local publishing helper. Never force-pushes or handles raw credentials. */
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const REPOSITORY='RusselRillema/SingleTake';
export const REMOTE='https://github.com/'+REPOSITORY+'.git';
export function parseOptions(args){const allowed=new Set(['--dry-run','--set-origin','--pages','--help']);for(const arg of args)if(!allowed.has(arg))throw Error('Unknown publish option: '+arg);return {dryRun:args.includes('--dry-run'),setOrigin:args.includes('--set-origin'),pages:args.includes('--pages'),help:args.includes('--help')};}
export function publishPlan(options){return [
 'Verify source, tests, full-history naming audit and static build.',
 'Require a clean local Git repository with committed application files.',
 ...(options.setOrigin?['Explicitly set origin to '+REMOTE+'.']:['Require origin to match '+REPOSITORY+'.']),
 'Fetch an existing main branch and require a fast-forward; never overwrite unrelated remote history.',
 'Push HEAD to main and verify the remote commit SHA.',
 ...(options.pages?['Use your authenticated GitHub CLI to configure Pages for Actions.','Dispatch pages.yml; inspect its run before treating the site as live.']:['Enable Pages → GitHub Actions in repository settings, then run pages.yml.'])
 ];}
function execute(cmd,args,{root,capture=false,allowFailure=false}={}){const result=spawnSync(cmd,args,{cwd:root,encoding:'utf8',stdio:capture?'pipe':'inherit',maxBuffer:16*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});if(result.error)throw Error(cmd+' is unavailable: '+result.error.message);if(result.status!==0&&!allowFailure)throw Error(cmd+' failed ('+result.status+'). '+(capture?result.stderr.trim():'See command output.'));return result;}
export async function publish(options,{root=fileURLToPath(new URL('../',import.meta.url))}={}){
 if(options.help){console.log('node tools/publish.mjs [--dry-run] [--set-origin] [--pages]\nRequires Git; --pages also requires an authenticated GitHub CLI. No force update is available.');return;}
 console.log(JSON.stringify({repository:REPOSITORY,dryRun:options.dryRun,plan:publishPlan(options)},null,2));if(options.dryRun)return;
 const git=(args,extra={})=>execute('git',args,{root,...extra});const top=git(['rev-parse','--show-toplevel'],{capture:true}).stdout.trim();if(resolve(top)!==resolve(root))throw Error('Clone the supplied Git bundle first; a source ZIP has no commit history.');
 if(git(['status','--porcelain'],{capture:true}).stdout.trim())throw Error('Commit or separately preserve local changes before publishing.');
 execute(process.execPath,['tools/verify.mjs'],{root});const head=git(['rev-parse','HEAD'],{capture:true}).stdout.trim();
 if(options.pages)execute('gh',['auth','status'],{root});
 const origin=git(['remote','get-url','origin'],{capture:true,allowFailure:true});
 if(options.setOrigin)git(origin.status===0?['remote','set-url','origin',REMOTE]:['remote','add','origin',REMOTE]);
 const remote=git(['remote','get-url','origin'],{capture:true}).stdout.trim();if(![REMOTE,REMOTE.slice(0,-4),'git@github.com:'+REPOSITORY+'.git'].includes(remote))throw Error('Origin is not the target repository. Use --set-origin to change it explicitly.');
 const branches=git(['ls-remote','--heads','origin','main'],{capture:true}).stdout.trim();
 if(branches){git(['fetch','--no-tags','origin','main']);const ancestor=git(['merge-base','--is-ancestor','FETCH_HEAD',head],{capture:true,allowFailure:true});if(ancestor.status!==0)throw Error('Remote history is not an ancestor. Review and integrate it before publishing; no force push will be attempted.');}
 git(['push','--set-upstream','origin','HEAD:refs/heads/main']);const actual=git(['ls-remote','--heads','origin','main'],{capture:true}).stdout.trim().split(/\s+/)[0];if(actual!==head)throw Error('Remote main moved after publication. Review the repository before deploying.');console.log('Verified remote main: '+head);
 if(options.pages){
  const endpoint='repos/'+REPOSITORY+'/pages',current=execute('gh',['api',endpoint],{root,capture:true,allowFailure:true});
  if(current.status===0){const info=JSON.parse(current.stdout);if(info.build_type!=='workflow')execute('gh',['api','--method','PUT',endpoint,'-f','build_type=workflow'],{root});}
  else if(/\b404\b/.test(current.stderr))execute('gh',['api','--method','POST',endpoint,'-f','build_type=workflow'],{root});
  else throw Error('Pages configuration cannot be read. Check repository Pages permissions.');
  execute('gh',['workflow','run','pages.yml','--repo',REPOSITORY,'--ref','main'],{root});
  console.log('Deployment requested, not verified live. Check: gh run list --repo '+REPOSITORY+' --workflow pages.yml');
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await publish(parseOptions(process.argv.slice(2)));}catch(error){console.error(error.message);process.exitCode=1;}
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const scripts = path.dirname(fileURLToPath(import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function fixture(t, options = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-')));
  const root = path.join(base, 'framework'), app = path.join(root, 'apps', 'test-app');
  const write = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
  const init = dir => { fs.mkdirSync(dir, { recursive: true }); git(dir, 'init', '-b', 'main'); git(dir, 'config', 'user.email', 'qa@example.invalid'); git(dir, 'config', 'user.name', 'Deploy test'); git(dir, 'remote', 'add', 'origin', dir); };
  const commit = dir => { git(dir, 'add', '.'); git(dir, 'commit', '-m', 'fixture'); };
  init(root);
  fs.cpSync(path.join(scripts, 'hosting'), path.join(root, 'scripts', 'hosting'), { recursive: true });
  fs.copyFileSync(path.join(scripts, 'deploy.sh'), path.join(root, 'scripts', 'deploy.sh'));
  write(path.join(root, '.gitignore'), 'apps/\nnode_modules/\nbuild-versions.tsv\n');
  write(path.join(root, 'framework-id'), 'one'); commit(root); git(root, 'tag', 'v1.0.0');
  write(path.join(root, 'framework-id'), 'two'); commit(root); git(root, 'tag', 'v2.0.0');
  init(app);
  write(path.join(app, '.gitignore'), '.env\ndist/\n');
  write(path.join(app, '.env.example'), 'VITE_APP_VERSION_CONFIG={"appId":"TEST","environmentTypeId":"AppEnvDev","buildVersion":""}\n');
  write(path.join(app, 'firebase.json'), JSON.stringify({hosting:[{target:'prod',public:'dist',rewrites:[{source:'**',destination:'/index.html'}]}]}));
  write(path.join(app, '.firebaserc'), JSON.stringify({projects:{prod:'test-project'},targets:{'test-project':{hosting:{prod:['test-site']}}}}));
  write(path.join(app, 'package.json'), JSON.stringify({name:'test-app',version:'3.4.2'}));
  write(path.join(app, '.github/workflows/firebase-hosting-release.yml'), 'with:\n  accxuiVersion: v1.0.0 # old dependency\n');
  commit(app); git(app,'tag','v3.4.2');
  write(path.join(app, 'package.json'), JSON.stringify({name:'test-app',version:'3.5.0'}));
  write(path.join(app, '.github/workflows/firebase-hosting-release.yml'), `with:\n  accxuiVersion: '${options.missingPin ? 'v9.9.9' : 'v2.0.0'}'\n`);
  commit(app); git(app,'tag','v3.5.0');
  write(path.join(app,'.env'),'original local config\n');
  const log = path.join(base,'calls.jsonl'), firebaseLog = path.join(base,'firebase-called');
  const bin = path.join(base,'bin'); fs.mkdirSync(bin);
  write(path.join(bin,'firebase'), `#!/bin/sh\necho called >> '${firebaseLog}'\nexit 97\n`);
  write(path.join(bin,'pnpm'), `#!/usr/bin/env node
const fs=require('fs'),path=require('path');
const root=process.cwd(),app=path.join(root,'apps/test-app');
const version=JSON.parse(fs.readFileSync(path.join(app,'package.json'))).version;
const framework=fs.readFileSync(path.join(root,'framework-id'),'utf8');
const mode=process.argv.includes('install')?'install':'build';
if (framework !== (version==='3.4.2'?'one':'two')) throw Error('Wrong framework for app release');
if (mode==='install'&&!process.argv.includes('--frozen-lockfile')) throw Error('Install must be frozen');
const config=mode==='build'?JSON.parse(process.env.VITE_APP_VERSION_CONFIG):null;
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({mode,version,framework,config})+'\\n');
if (${JSON.stringify(options.fail || '')}===mode) process.exit(8);
if(config){const dir=path.join(app,'dist',config.buildVersion);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'index.html'),JSON.stringify(config));}
`);
  fs.chmodSync(path.join(bin,'pnpm'),0o755); fs.chmodSync(path.join(bin,'firebase'),0o755);
  t.after(() => {
    // Only these synthetic fixture repos are cleaned. App worktrees precede their parent framework.
    for(const repo of [app,root]) {
      const paths=git(repo,'worktree','list','--porcelain').split('\n').filter(x=>x.startsWith('worktree ')).map(x=>x.slice(9));
      for(const w of paths.filter(w=>w!==repo)) { git(w,'restore','.'); git(repo,'worktree','remove',w); }
    }
    fs.rmSync(base,{recursive:true});
  });
  const original = [git(root,'rev-parse','HEAD'),git(app,'rev-parse','HEAD')];
  const run=spawnSync('bash',[path.join(root,'scripts/deploy.sh'),'--build-only'],{
    cwd:root,input:'1\n3\n2\ny\n',encoding:'utf8',timeout:30000,
    env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,VITE_APP_VERSION_CONFIG:'{"appId":"WRONG","environmentTypeId":"AppEnvUAT","buildVersion":"wrong"}'}
  });
  assert.equal(fs.existsSync(firebaseLog),false,'build-only must never call Firebase, even authentication');
  assert.deepEqual([git(root,'rev-parse','HEAD'),git(app,'rev-parse','HEAD')],original);
  assert.equal(fs.readFileSync(path.join(app,'.env'),'utf8'),'original local config\n');
  assert.equal(git(root,'status','--porcelain'),'');assert.equal(git(app,'status','--porcelain'),'');
  return {root,run,calls:fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse):[]};
}
test('build-only selects each framework, freezes installs, overrides inherited UAT config and preserves callers', t => {
  const {root,run,calls}=fixture(t); assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
  assert.deepEqual(calls.filter(c=>c.mode==='install').map(c=>c.framework),['two','one']);
  const builds=calls.filter(c=>c.mode==='build');
  assert.deepEqual(builds.map(c=>c.config.buildVersion),['','v3.5.0','v3.4.2']);
  assert.ok(builds.every(c=>c.config.environmentTypeId==='AppEnvProd'&&c.config.appId==='TEST'));
  const worktree=path.join(root,'apps/_worktrees',fs.readdirSync(path.join(root,'apps/_worktrees'))[0]);
  const builtApp=path.join(worktree,'apps/test-app');
  assert.deepEqual(fs.readdirSync(path.join(builtApp,'dist')).filter(name=>/^v\d/.test(name)).sort(),['v3.4.2','v3.5.0']);
  assert.equal(fs.existsSync(path.join(builtApp,'dist/hosted-versions.json')),false);
  const config=JSON.parse(fs.readFileSync(path.join(builtApp,'firebase.json')));
  assert.ok(config.hosting[0].rewrites.some(r=>r.source==='/v3.4.2/**'));
  assert.ok(fs.existsSync(path.join(builtApp,'dist/service-worker.js')));
});
test('missing framework tag fails before any install or Firebase call', t => {
  const {run,calls}=fixture(t,{missingPin:true});assert.notEqual(run.status,0);assert.match(run.stderr,/unavailable AccxUI ref/);assert.deepEqual(calls,[]);
});
for(const fail of ['install','build']) test(`${fail} failure stops preparation without touching caller state or Firebase`,t=>{
  const {run,calls}=fixture(t,{fail});assert.notEqual(run.status,0);assert.equal(calls.at(-1).mode,fail);
});

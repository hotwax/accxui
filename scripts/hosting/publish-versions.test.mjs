import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, planPublication, verifyPreserved, publishPrepared } from './publish-versions.mjs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
const file = (p, hash = 'a'.repeat(64)) => ({ path: p, hash, status: 'ACTIVE' });
const baseline = () => ({ release: { name: 'sites/demo/channels/live/releases/old', version: { name: 'sites/demo/versions/old', config: { redirects: [{ glob: '/old', location: '/new', statusCode: 302 }], rewrites: [{ glob: '**', path: '/index.html' }], headers: [{ glob: '**', headers: { 'X-Frame-Options': 'SAMEORIGIN' } }] } } }, files: [file('/index.html'), file('/sw.js'), file('/assets/a.js'), file('/v1.0.0/index.html')] });
// This is an in-memory model of Hosting orchestration, not evidence of a deployed Firebase pass.
function fakeHosting(before, { race = 0, corrupt = false } = {}) {
  const calls = []; let reads = 0; let config; let published = false; let files = structuredClone(before.files);
  const api = async (method, url, body) => {
    calls.push({ method, url });
    if (url.endsWith('/releases') && method === 'GET') {
      reads++;
      return { releases: [{ name: race === reads ? 'changed' : published ? 'new-release' : before.release.name, version: { name: published ? 'sites/demo/versions/new' : before.release.version.name } }] };
    }
    if (url.endsWith(':clone')) return { done: true, response: { name: 'sites/demo/versions/new' } };
    if (url.endsWith('/files')) return { files };
    if (url.endsWith(':populateFiles')) { files.push(...Object.entries(body.files).map(([p, h]) => file(p, h))); return { uploadRequiredHashes: Object.values(body.files), uploadUrl: 'https://upload-firebasehosting.googleapis.com/test' }; }
    if (method === 'PATCH') { config = body.config; if (corrupt) files[0].hash = 'b'.repeat(64); return {}; }
    if (method === 'GET' && url.endsWith('/versions/new')) return { name: 'sites/demo/versions/new', config };
    if (method === 'POST' && url.endsWith('/releases')) { published = true; return { name: 'new-release' }; }
    throw Error('Unexpected test request ' + method + ' ' + url);
  };
  return { api, upload: async (_url, digest, bytes) => assert.equal(createHash('sha256').update(bytes).digest('hex'), digest), calls };
}
test('publish-only is opt-in and requires explicit environment, channel and stable tags', () => {
  const o = parseOptions(['--app','products','--environment','uat','--versions','v1.1.0','--channel','live']); assert.equal(o.execute, undefined);
  for (const args of [[], ['--app','../company'], ['--app','products','--environment','uat','--versions','main','--channel','live']]) assert.throws(() => parseOptions(args));
});
test('keeps root configuration and adds only scoped routes and headers', () => {
  const b=baseline(), original=structuredClone(b);const p=planPublication(b,['v1.0.0','v1.1.0']);
  assert.deepEqual(b,original);assert.deepEqual(p.existing,['v1.0.0']);assert.deepEqual(p.additions,['v1.1.0']);
  assert.deepEqual(p.config.rewrites.slice(1),b.release.version.config.rewrites);assert.deepEqual(p.config.redirects,b.release.version.config.redirects);
  assert.deepEqual(p.config.headers.slice(0,-1),b.release.version.config.headers);
  assert.equal(new RegExp(p.config.rewrites[0].regex).test('/product-store'),false);
  assert.equal(new RegExp(p.config.rewrites[0].regex).test('/v1.1.0/products'),true);
});
test('refuses incomplete hosted versions and missing default',()=>{
  const b=baseline();b.files.push(file('/v1.1.0/assets/a.js'));assert.throws(()=>planPublication(b,['v1.1.0']),/Incomplete/);
  b.files=b.files.filter(f=>f.path!='/index.html');assert.throws(()=>planPublication(b,['v1.2.0']),/default/);
});
test('preservation checks reject removal, overwrite and unexpected root files',()=>{
 const b=baseline().files;assert.throws(()=>verifyPreserved(b,b.slice(1),[]),/Existing/);
 const changed=structuredClone(b);changed[1].hash='b'.repeat(64);assert.throws(()=>verifyPreserved(b,changed,[]),/Existing/);
 assert.throws(()=>verifyPreserved(b,[...b,file('/root-new.js')],[]),/Unexpected/);
});
test('adds version files and verifies all existing hashes before and after release',async()=>{
 const b=baseline(),p=planPublication(b,['v1.1.0']), c=fakeHosting(b);
 const r=await publishPrepared(c,'demo','live',b,p,new Map([['/v1.1.0/index.html',Buffer.from('version')]]));
 assert.equal(r.preservedFiles,4);assert.equal(r.addedFiles,1);
 assert.equal(c.calls.filter(c=>c.method==='POST'&&c.url.endsWith('/releases')).length,1);
});
test('repeating publication of an existing version makes no Firebase writes',async()=>{
 const b=baseline(),c=fakeHosting(b);assert.deepEqual(await publishPrepared(c,'demo','live',b,planPublication(b,['v1.0.0']),new Map()),{skipped:['v1.0.0']});assert.equal(c.calls.length,0);
});
for (const race of [1,2]) test(`stale release at checkpoint ${race} never publishes`,async()=>{
 const b=baseline(),c=fakeHosting(b,{race});await assert.rejects(()=>publishPrepared(c,'demo','live',b,planPublication(b,['v1.1.0']),new Map([['/v1.1.0/index.html',Buffer.from('x')]])),/changed/);
 assert.equal(c.calls.some(c=>c.method==='POST'&&c.url.endsWith('/releases')),false);
});
test('rejects changed preserved content before making it live',async()=>{
 const b=baseline(),c=fakeHosting(b,{corrupt:true});await assert.rejects(()=>publishPrepared(c,'demo','live',b,planPublication(b,['v1.1.0']),new Map([['/v1.1.0/index.html',Buffer.from('x')]])),/Existing file changed/);
 assert.equal(c.calls.some(c=>c.method==='POST'&&c.url.endsWith('/releases')),false);
});

import { readFile, writeFile, mkdir, mkdtemp, readdir, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stable = /^v\d+\.\d+\.\d+$/;
const id = /^[a-z0-9][a-z0-9-]*$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const run = (cwd, command, args, options = {}) => execFileSync(command, args, { cwd, encoding: 'utf8', ...options });

export function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === '--execute') { options.execute = true; continue; }
    if (!['--app', '--environment', '--versions', '--channel', '--confirm-production'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Invalid option: ${key}`);
    if (options[key.slice(2)] !== undefined) throw new Error(`Duplicate option: ${key}`);
    options[key.slice(2)] = args[++i];
  }
  if (!id.test(options.app || '') || !['uat', 'prod'].includes(options.environment)) throw new Error('Specify --app and --environment uat|prod');
  options.versions = (options.versions || '').split(',');
  if (!options.versions.length || options.versions.some(v => !stable.test(v)) || new Set(options.versions).size !== options.versions.length) throw new Error('Specify distinct released vX.Y.Z versions');
  if (!id.test(options.channel || '')) throw new Error('Specify --channel explicitly (live or an existing preview channel)');
  return options;
}

export function planPublication(snapshot, versions) {
  if (!snapshot.release?.name || !snapshot.release.version?.name || !snapshot.files.some(f => f.path === '/index.html')) throw new Error('An existing deployed default is required');
  if (snapshot.files.some(f => f.status !== 'ACTIVE' || !/^[a-f0-9]{64}$/.test(f.hash))) throw new Error('Invalid baseline file manifest');
  if (versions.some(v => !stable.test(v))) throw new Error('Invalid version');
  const existing = versions.filter(v => snapshot.files.some(f => f.path.startsWith(`/${v}/`)));
  for (const version of existing) {
    if (!snapshot.files.some(f => f.path === `/${version}/index.html`)) throw new Error(`Incomplete existing version: ${version}`);
  }
  const additions = versions.filter(v => !existing.includes(v));
  const config = structuredClone(snapshot.release.version.config || {});
  // Existing config is retained verbatim; only exact new version prefixes gain routes/headers.
  config.rewrites = [...additions.map(v => ({ regex: `^/${v.replaceAll('.', '\\.')}(?:/.*)?$`, path: `/${v}/index.html` })), ...(config.rewrites || [])];
  if (additions.length) config.headers = [...(config.headers || []), ...additions.map(v => ({ regex: `^/${v.replaceAll('.', '\\.')}(?:/.*)?$`, headers: { 'Cache-Control': 'no-cache' } }))];
  return { baseRelease: snapshot.release.name, baseVersion: snapshot.release.version.name, existing, additions, config };
}

export function verifyPreserved(before, after, additions) {
  const actual = new Map(after.map(f => [f.path, f]));
  if (actual.size !== after.length) throw new Error('Duplicate files in published manifest');
  for (const old of before) {
    if (actual.get(old.path)?.hash !== old.hash || actual.get(old.path)?.status !== 'ACTIVE') throw new Error(`Existing file changed: ${old.path}`);
  }
  const prior = new Set(before.map(f => f.path));
  for (const f of after) if (!prior.has(f.path) && !additions.some(v => f.path.startsWith(`/${v}/`))) throw new Error(`Unexpected new path: ${f.path}`);
  for (const v of additions) if (!actual.has(`/${v}/index.html`)) throw new Error(`Missing version entry: ${v}`);
}

export async function firebaseConnection() {
  const lib = process.env.FIREBASE_TOOLS_LIB || path.join(run(root, 'npm', ['root', '-g']).trim(), 'firebase-tools/lib');
  const require = createRequire(import.meta.url);
  const auth = require(path.join(lib, 'auth.js'));
  const { requireAuth } = require(path.join(lib, 'requireAuth.js'));
  const { Client } = require(path.join(lib, 'apiv2.js'));
  const options = { nonInteractive: true, token: process.env.HOTWAX_PUBLIC_SECRET, account: process.env.FIREBASE_ACCOUNT };
  if (options.account) auth.setActiveAccount(options, auth.selectAccount(options.account));
  await requireAuth(options, true);
  const client = new Client({ urlPrefix: 'https://firebasehosting.googleapis.com', apiVersion: 'v1beta1', auth: true });
  const api = async (method, route, body, queryParams) => {
    try { return (await client.request({ method, path: route, ...(body ? { body } : {}), ...(queryParams ? { queryParams } : {}) })).body; }
    catch (error) { throw new Error(`Firebase ${method} ${route} failed (HTTP ${error.status || 'unknown'})`); }
  };
  const upload = async (url, digest, bytes) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'upload-firebasehosting.googleapis.com') throw new Error('Unexpected Firebase upload origin');
    const uploader = new Client({ urlPrefix: url, auth: true });
    try { await uploader.request({ method: 'POST', path: `/${digest}`, body: bytes, headers: { 'Content-Type': 'application/octet-stream' } }); }
    catch (error) { throw new Error(`Firebase upload failed (HTTP ${error.status || 'unknown'})`); }
  };
  return { api, upload };
}

export async function snapshot(api, site, channel) {
  const response = await api('GET', `/sites/${site}/channels/${channel}/releases`, undefined, { pageSize: 1 });
  const release = response.releases?.[0];
  if (!release?.version?.name || release.type === 'SITE_DISABLE') throw new Error('Channel has no active deployment');
  release.version = await api('GET', `/${release.version.name}`);
  return { release, files: await listFiles(api, release.version.name) };
}
export async function listFiles(api, version) {
  const files = []; let pageToken;
  do {
    const result = await api('GET', `/${version}/files`, undefined, { pageSize: 1000, ...(pageToken ? { pageToken } : {}) });
    files.push(...(result.files || [])); pageToken = result.nextPageToken;
  } while (pageToken);
  return files;
}
export async function cloneVersion(api, site, sourceVersion, extra = {}) {
  let operation = await api('POST', `/sites/${site}/versions:clone`, { sourceVersion, finalize: false, ...extra });
  const deadline = Date.now() + 120000;
  while (!operation.done) {
    if (!operation.name || Date.now() > deadline) throw new Error('Firebase clone timed out');
    await new Promise(resolve => setTimeout(resolve, 1000));
    operation = await api('GET', `/${operation.name}`);
  }
  if (operation.error || !operation.response?.name) throw new Error('Firebase clone failed');
  return operation.response;
}

export async function publishPrepared({ api, upload }, site, channel, before, plan, artifacts) {
  if (!plan.additions.length) return { skipped: plan.existing };
  const assertUnchanged = async () => {
    const now = await api('GET', `/sites/${site}/channels/${channel}/releases`, undefined, { pageSize: 1 });
    if (now.releases?.[0]?.name !== plan.baseRelease) throw new Error('Channel changed since preparation; retry');
  };
  // Never create a new deployment from a stale snapshot.
  await assertUnchanged();
  const cloned = await cloneVersion(api, site, plan.baseVersion);
  verifyPreserved(before.files, await listFiles(api, cloned.name), []);
  const entries = [...artifacts.entries()];
  if (!entries.length || entries.some(([p]) => !plan.additions.some(v => p.startsWith(`/${v}/`)) || /[\\%?#\x00-\x20]/.test(p) || p.split('/').some(s => s === '.' || s === '..'))) throw new Error('Unsafe artifact paths');
  const blobs = new Map();
  const fileMap = Object.fromEntries(entries.map(([p, bytes]) => { const compressed = gzipSync(bytes, { level: 9 }); const digest = hash(compressed); blobs.set(digest, compressed); return [p, digest]; }));
  for (let offset = 0; offset < entries.length; offset += 500) {
    const batch = Object.fromEntries(entries.slice(offset, offset + 500).map(([p]) => [p, fileMap[p]]));
    const result = await api('POST', `/${cloned.name}:populateFiles`, { files: batch });
    for (const digest of result.uploadRequiredHashes || []) {
      if (!blobs.has(digest)) throw new Error('Firebase requested an unknown artifact hash');
      await upload(result.uploadUrl, digest, blobs.get(digest));
    }
  }
  await api('PATCH', `/${cloned.name}`, { config: plan.config, status: 'FINALIZED' }, { updateMask: 'config,status' });
  const ready = await api('GET', `/${cloned.name}`);
  if (!isDeepStrictEqual(ready.config, plan.config)) throw new Error('Hosting configuration differs from plan');
  const files = await listFiles(api, cloned.name);
  verifyPreserved(before.files, files, plan.additions);
  for (const [p, digest] of Object.entries(fileMap)) if (files.find(f => f.path === p)?.hash !== digest) throw new Error(`New file not verified: ${p}`);
  await assertUnchanged();
  const released = await api('POST', `/sites/${site}/channels/${channel}/releases`, { message: `Add versions ${plan.additions.join(', ')}; preserve ${plan.baseVersion}` }, { versionName: cloned.name });
  const after = await snapshot(api, site, channel);
  if (after.release.name !== released.name) throw new Error('Another release replaced this publication; inspect channel');
  verifyPreserved(before.files, after.files, plan.additions);
  return { release: released.name, version: cloned.name, preservedFiles: before.files.length, addedFiles: entries.length, after };
}

async function buildVersion(appDirectory, version, environment, workspace) {
  const workflow = run(appDirectory, 'git', ['show', `${version}:.github/workflows/firebase-hosting-release.yml`]);
  const framework = workflow.match(/^\s*accxuiVersion:\s*["']?([^\s"'#]+)/m)?.[1];
  if (!framework) throw new Error(`${version} has no recorded framework pin`);
  const base = path.join(workspace, version);
  run(root, 'git', ['worktree', 'add', '--detach', base, framework], { stdio: 'inherit' });
  const app = path.join(base, 'apps', path.basename(appDirectory));
  run(appDirectory, 'git', ['worktree', 'add', '--detach', app, version], { stdio: 'inherit' });
  const example = await readFile(path.join(app, '.env.example'), 'utf8');
  const config = JSON.parse(example.match(/^VITE_APP_VERSION_CONFIG=(.*)$/m)?.[1] || 'null');
  if (!config?.appId) throw new Error(`${version} has no version build configuration`);
  const buildConfig = { ...config, buildVersion: version, environmentTypeId: environment === 'uat' ? 'AppEnvUAT' : 'AppEnvProd' };
  await writeFile(path.join(app, '.env'), example);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITE_')));
  env.CI = 'true'; env.VITE_APP_VERSION_CONFIG = JSON.stringify(buildConfig);
  for (const key of ['VITE_FIREBASE_CONFIG', 'VITE_FIREBASE_VAPID_KEY']) if (process.env[key]) env[key] = process.env[key];
  run(base, 'pnpm', ['install', '--frozen-lockfile'], { env, stdio: 'inherit' });
  run(app, 'pnpm', ['build'], { env, stdio: 'inherit' });
  const folder = path.join(app, 'dist', version);
  const index = await readFile(path.join(folder, 'index.html'), 'utf8');
  if (!index.includes(`/${version}/assets/`)) throw new Error('Build does not reference version-scoped assets');
  // Version-scoped recovery only. Never run prepareHosting over the preserved root.
  await writeFile(path.join(folder, 'service-worker.js'), await readFile(new URL('./retire-legacy-worker.js', import.meta.url)));
  const artifacts = new Map();
  async function collect(dir, prefix) {
    for (const entry of await readdir(dir)) {
      const file = path.join(dir, entry); const stat = await lstat(file);
      if (stat.isSymbolicLink()) throw new Error('Symlinks are not publishable');
      if (stat.isDirectory()) await collect(file, `${prefix}/${entry}`);
      else artifacts.set(`${prefix}/${entry}`, await readFile(file));
    }
  }
  await collect(folder, `/${version}`);
  await writeFile(path.join(base, 'build-record.json'), JSON.stringify({ version, appCommit: run(app, 'git', ['rev-parse', 'HEAD']).trim(), frameworkCommit: run(base, 'git', ['rev-parse', 'HEAD']).trim(), config: buildConfig }, null, 2));
  return artifacts;
}

export async function main(args) {
  const options = parseOptions(args);
  const app = path.join(root, 'apps', options.app);
  const rc = JSON.parse(await readFile(path.join(app, '.firebaserc'), 'utf8'));
  const project = rc.projects?.[options.environment]; const sites = rc.targets?.[project]?.hosting?.[options.environment];
  if (!project || sites?.length !== 1 || !id.test(sites[0])) throw new Error('Expected exactly one configured Hosting target');
  const site = sites[0];
  if (options.execute && options.environment === 'prod' && options['confirm-production'] !== site) throw new Error(`Production requires --confirm-production ${site}`);
  const connection = await firebaseConnection();
  const before = await snapshot(connection.api, site, options.channel);
  const plan = planPublication(before, options.versions);
  await mkdir(path.join(root, 'apps/_worktrees'), { recursive: true });
  const workspace = await mkdtemp(path.join(root, `apps/_worktrees/publish-${options.app}-${options.environment}-`));
  await writeFile(path.join(workspace, 'before.json'), JSON.stringify(before, null, 2));
  await writeFile(path.join(workspace, 'plan.json'), JSON.stringify({ project, site, channel: options.channel, ...plan }, null, 2));
  console.log(JSON.stringify({ project, site, channel: options.channel, mode: options.execute ? 'publish-only' : 'plan-only', additions: plan.additions, preserved: plan.existing, workspace }));
  if (!options.execute || !plan.additions.length) return;
  const artifacts = new Map();
  for (const version of plan.additions) {
    // Require a published, non-draft GitHub release, not a moving branch or invented folder name.
    const release = JSON.parse(run(app, 'gh', ['release', 'view', version, '--json', 'isDraft,isPrerelease,tagName']));
    if (release.isDraft || release.isPrerelease || release.tagName !== version) throw new Error('Only published stable releases can be added');
    for (const [file, bytes] of await buildVersion(app, version, options.environment, workspace)) artifacts.set(file, bytes);
  }
  const result = await publishPrepared(connection, site, options.channel, before, plan, artifacts);
  await writeFile(path.join(workspace, 'after.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ release: result.release, preservedFiles: result.preservedFiles, addedFiles: result.addedFiles, workspace }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

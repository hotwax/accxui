#!/usr/bin/env node
// moqui-console — a lightweight, LOCAL-ONLY, READ-ONLY dev dashboard for bare-metal Moqui.
//
// What it does (read-only — it never starts/stops/kills anything):
//   - discovers the ACTIVE Moqui checkout from the running process (never hardcodes a path)
//   - preflight: Java 11, ports 8080/3306/8983/9200, MySQL/Solr reachability, Moqui liveness
//   - effective config: parses runtime/log/MoquiActualConf.xml (<default-property> lines, secrets redacted)
//   - components: lists runtime/component/* with each one's git branch + symlink target (flags drift)
//   - logs: byte-offset tail of the bare-metal Moqui log (never full-reads the ~70MB file)
//   - diagnose: turns the observed signals into concrete next-actions + copy-paste commands
//
// Run from the accxui repo root:  pnpm console   (== node moqui-console.mjs)
// Then open http://127.0.0.1:7070  — bound to localhost only.
//
// Zero dependencies, no build step. Requires Node 18+ (uses global fetch). Verified on Node 25.

import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { readFile, open, readdir, lstat, readlink, stat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ─── CONFIG (machine-specific; edit once) ───────────────────────────────────
const CONFIG = {
  host: '127.0.0.1',
  port: 7070,
  java11: '/opt/homebrew/opt/openjdk@11/bin/java',          // explicit Java 11 (NOT on default PATH)
  ports: { moqui: 8080, mysql: 3306, solr: 8983, elasticsearch: 9200 },
  moquiLiveness: 'http://localhost:8080/rest/s1/admin/checkLoginOptions', // no-auth liveness probe
  solrProbe: 'http://localhost:8983/solr/',                 // 401 here still means "Solr is alive"
  esProbe: 'http://127.0.0.1:9200',
  // Fallback only if no Moqui process is running: parse the `cd <path>` out of this run script.
  fallbackRunScript: '/Users/adityapatel/Documents/GitHub/moqui-framework/run-notnaked-moqui-local.sh',
  // Hints shown in the UI for the (manual) lifecycle this read-only console intentionally does NOT do:
  startHint: 'screen -dmS notnaked-moqui bash /Users/adityapatel/Documents/GitHub/moqui-framework/run-notnaked-moqui-local.sh',
}

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SANE_PATH = '/usr/sbin:/usr/bin:/bin:/sbin:/opt/homebrew/bin:' + (process.env.PATH || '')

// ─── small helpers ──────────────────────────────────────────────────────────

// Run a binary, never throw — always resolve {code, stdout, stderr}.
function run(bin, args, timeout = 6000) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout, env: { ...process.env, PATH: SANE_PATH }, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout: stdout || '', stderr: stderr || '', failed: !!err }))
  })
}

// HTTP probe with a hard timeout. ok:true means we got *a* response (even 401/403 = the server is alive).
async function probe(url, ms = 4000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: 'manual' })
    let body = ''
    try { body = (await r.text()).slice(0, 2000) } catch { /* ignore */ }
    return { ok: true, status: r.status, body }
  } catch (e) {
    return { ok: false, error: e.code || e.name || String(e) }
  } finally {
    clearTimeout(t)
  }
}

// Which process (if any) is LISTENing on a TCP port. Returns {listening, pid, command}.
async function portOwner(port) {
  const r = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpcn'])
  if (!r.stdout.trim()) return { listening: false }
  let pid, command
  for (const line of r.stdout.split('\n')) {
    if (line[0] === 'p') pid = line.slice(1)
    else if (line[0] === 'c') command = line.slice(1)
  }
  return { listening: true, pid, command }
}

// ─── discovery: find the ACTIVE Moqui checkout from the running process ──────
let _moquiHome = null
async function discover(force = false) {
  if (_moquiHome && !force) return _moquiHome
  const ps = await run('ps', ['-ax', '-o', 'pid=,command='])
  let pid = null, cmdline = null
  for (const line of ps.stdout.split('\n')) {
    if (line.includes('-jar moqui.war')) {
      const m = line.trim().match(/^(\d+)\s+(.*)$/)
      if (m) { pid = m[1]; cmdline = m[2]; break }
    }
  }
  let home = null, source = 'process'
  if (pid) {
    const r = await run('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn'])
    const n = r.stdout.split('\n').find((l) => l[0] === 'n')
    if (n) { try { home = await realpath(n.slice(1)) } catch { home = n.slice(1) } }
  }
  if (!home) { // process not running — derive from the run script's `cd` target
    source = 'fallback'
    try {
      const s = await readFile(CONFIG.fallbackRunScript, 'utf8')
      const m = s.match(/^\s*cd\s+(\S+)/m)
      if (m) { try { home = await realpath(m[1]) } catch { home = m[1] } }
    } catch { /* ignore */ }
  }
  _moquiHome = { pid, cmdline, home, source }
  return _moquiHome
}

// ─── endpoint implementations ────────────────────────────────────────────────

async function apiDiscover() {
  return discover(true)
}

async function apiPreflight() {
  const [java11, bareJava, moqui, mysql, solr, es, live, solrProbe] = await Promise.all([
    run(CONFIG.java11, ['-version']),
    run('java', ['-version']),
    portOwner(CONFIG.ports.moqui),
    portOwner(CONFIG.ports.mysql),
    portOwner(CONFIG.ports.solr),
    portOwner(CONFIG.ports.elasticsearch),
    probe(CONFIG.moquiLiveness),
    probe(CONFIG.solrProbe),
  ])
  // java -version writes to stderr
  const java11Ver = (java11.stderr || java11.stdout).split('\n')[0] || ''
  return {
    java11: { ok: !java11.failed, detail: java11.failed ? 'openjdk@11 not found at ' + CONFIG.java11 : java11Ver },
    bareJava: { ok: !bareJava.failed, detail: bareJava.failed ? 'bare `java` fails (expected on this box — only the run script sets JAVA_HOME)' : (bareJava.stderr || '').split('\n')[0] },
    ports: {
      moqui: { ...moqui, expected: CONFIG.ports.moqui },
      mysql: { ...mysql, expected: CONFIG.ports.mysql },
      solr: { ...solr, expected: CONFIG.ports.solr },
      elasticsearch: { ...es, expected: CONFIG.ports.elasticsearch },
    },
    moquiLive: live.ok && live.status === 200,
    moquiLiveDetail: live.ok ? `HTTP ${live.status}` : `unreachable (${live.error})`,
    solrAlive: solrProbe.ok, // any HTTP response (incl 401) = alive
    solrDetail: solrProbe.ok ? `HTTP ${solrProbe.status}${solrProbe.status === 401 ? ' (auth-protected, up)' : ''}` : `unreachable (${solrProbe.error})`,
  }
}

async function apiConfig() {
  const d = await discover()
  if (!d.home) return { error: 'Moqui checkout not found (no running process and no run-script fallback)' }
  const confPath = join(d.home, 'runtime', 'log', 'MoquiActualConf.xml')
  let xml
  try { xml = await readFile(confPath, 'utf8') } catch (e) { return { error: `cannot read ${confPath}: ${e.code}` } }

  // <default-property name="X" value="Y" [is-secret="true"]/>  — the *real* values live here.
  const props = {}
  const re = /<default-property\s+name="([^"]+)"\s+value="([^"]*)"(\s+is-secret="true")?\s*\/>/g
  let m
  while ((m = re.exec(xml))) props[m[1]] = m[3] ? '[secret]' : m[2]

  // search backends referenced anywhere in the merged conf (ES :9200 and/or Solr :8983)
  const searchRefs = [...new Set((xml.match(/https?:\/\/[^"'<>\s}]*(?:9200|8983)[^"'<>\s}]*/g) || []))]

  return {
    confPath,
    db: {
      conf: props.entity_ds_db_conf, host: props.entity_ds_host, port: props.entity_ds_port,
      database: props.entity_ds_database, user: props.entity_ds_user, schema: props.entity_ds_schema || '(default)',
    },
    searchRefs,
    instance: { purpose: props.instance_purpose, name: props['ofbiz.instance.name'], id: props['unique.instance.id'] },
    notable: {
      solr_cloud: props['solr.cloud.enable'], solr_cores: props['solr.shared.core.name'],
      shopify_api_version: props.shopify_api_version, locale: props.default_locale,
    },
  }
}

async function apiComponents() {
  const d = await discover()
  if (!d.home) return { error: 'Moqui checkout not found' }
  const dir = join(d.home, 'runtime', 'component')
  let names
  try { names = await readdir(dir) } catch (e) { return { error: `cannot read ${dir}: ${e.code}` } }
  const out = []
  for (const name of names.sort()) {
    if (name === 'README' || name.startsWith('.')) continue
    const full = join(dir, name)
    let target = null, isLink = false
    try { const st = await lstat(full); isLink = st.isSymbolicLink(); if (isLink) target = await readlink(full) } catch { /* ignore */ }
    const g = await run('git', ['-C', full, 'rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = g.failed ? null : g.stdout.trim()
    out.push({ name, branch, target, isLink, drift: !!branch && branch !== 'main' && branch !== 'HEAD' })
  }
  return { dir, components: out }
}

async function apiLogs(kb = 64) {
  const d = await discover()
  if (!d.home) return { error: 'Moqui checkout not found' }
  const logPath = join(d.home, 'runtime', 'log', 'notnaked-local.log')
  let fh
  try {
    fh = await open(logPath, 'r')
    const { size } = await fh.stat()
    const len = Math.min(kb * 1024, size)
    const buf = Buffer.alloc(len)
    await fh.read(buf, 0, len, size - len)
    return { logPath, size, shown: len, tail: buf.toString('utf8') }
  } catch (e) {
    return { error: `cannot read log: ${e.code}` }
  } finally {
    if (fh) await fh.close()
  }
}

async function apiDiagnose() {
  const [pre, cfg, log] = await Promise.all([apiPreflight(), apiConfig(), apiLogs(96)])
  const findings = []
  const add = (severity, title, detail, command) => findings.push({ severity, title, detail, command })
  const tail = (log.tail || '').toLowerCase()

  // Moqui liveness
  if (pre.moquiLive) add('ok', 'Moqui is up and serving', `${CONFIG.moquiLiveness} → ${pre.moquiLiveDetail}`)
  else if (pre.ports.moqui.listening) add('warn', 'Port 8080 is held but Moqui is not answering /rest', `pid ${pre.ports.moqui.pid} (${pre.ports.moqui.command}) holds 8080 but liveness ${pre.moquiLiveDetail}. Likely mid-boot or wedged — check the log tail.`)
  else add('error', 'Moqui is not running', 'Nothing is listening on 8080. Start it (this console is read-only):', CONFIG.startHint)

  // Java 11 (the #1 cold-start trap)
  if (!pre.java11.ok) add('error', 'Java 11 is missing', `${CONFIG.java11} did not run.`, 'brew install openjdk@11')
  else if (!pre.bareJava.ok) add('info', 'Java 11 is present but not on PATH (expected)', 'bare `java` fails; the run script sets JAVA_HOME, so Start still works. Nothing to fix unless you run gradlew by hand.')

  // MySQL
  if (!pre.ports.mysql.listening) add('error', 'MySQL is down', `Moqui expects MySQL on ${CONFIG.ports.mysql} (db ${cfg.db?.database}, user ${cfg.db?.user}). It cannot connect.`, 'brew services start mysql')

  // Solr / search
  if (!pre.solrAlive) add('warn', 'Solr is not responding on 8983', 'Search-backed APIs will fail.', `screen -dmS notnaked-solr ...`)
  const refsES = (cfg.searchRefs || []).some((u) => u.includes('9200'))
  if (refsES && !pre.ports.elasticsearch.listening) add('info', 'Config references ElasticSearch :9200 but nothing is listening there', 'Live search engine is Solr on 8983; ES :9200 is not up. Expected on this box — not a failure.')

  // Component drift
  const drifted = (await apiComponents()).components?.filter((c) => c.drift) || []
  if (drifted.length) add('info', `${drifted.length} component(s) are off \`main\``, drifted.map((c) => `${c.name} → ${c.branch}`).join(', '))

  // Log fingerprints (from the tail only)
  if (tail.includes('unable to locate a java runtime')) add('error', 'Log shows "Unable to locate a Java Runtime"', 'gradlew ran without JAVA_HOME. Start via the run script (which exports JAVA_HOME), not bare `./gradlew run`.', CONFIG.startHint)
  if (tail.includes('address already in use')) add('error', 'Log shows "Address already in use"', 'A port (likely 8080) is held by another process — often an orphaned GradleDaemon from a previous run.')
  if (tail.includes('communications link failure') || tail.includes('could not create connection to database')) add('error', 'Log shows a database connection failure', `Check MySQL on ${CONFIG.ports.mysql} (db ${cfg.db?.database}).`)
  if (tail.includes('build failed')) add('warn', 'Log shows "BUILD FAILED"', 'Gradle build failed during startup — read the tail for the failing task.')

  return { findings }
}

async function apiStatus() {
  const [d, moqui, live] = await Promise.all([discover(), portOwner(CONFIG.ports.moqui), probe(CONFIG.moquiLiveness, 3000)])
  return {
    moquiHome: d.home, pid: d.pid, source: d.source,
    moquiLive: live.ok && live.status === 200,
    port8080: moqui.listening,
  }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────
const ROUTES = {
  '/api/discover': apiDiscover,
  '/api/preflight': apiPreflight,
  '/api/config': apiConfig,
  '/api/components': apiComponents,
  '/api/status': apiStatus,
  '/api/diagnose': apiDiagnose,
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${CONFIG.host}:${CONFIG.port}`)
    const path = url.pathname

    if (path === '/' || path === '/index.html') {
      const html = await readFile(join(HERE, 'moqui-console.html'), 'utf8')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(html)
    }
    if (path === '/api/logs') {
      const kb = Math.min(parseInt(url.searchParams.get('kb') || '64', 10) || 64, 512)
      const data = await apiLogs(kb)
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(data))
    }
    if (ROUTES[path]) {
      const data = await ROUTES[path]()
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(data))
    }
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: String(e?.stack || e) }))
  }
})

server.listen(CONFIG.port, CONFIG.host, () => {
  console.log(`\n  moqui-console (read-only)  →  http://${CONFIG.host}:${CONFIG.port}\n`)
  console.log('  Discovering the active Moqui checkout from the running process…')
  discover(true).then((d) => {
    if (d.home) console.log(`  MOQUI_HOME = ${d.home}  (via ${d.source}${d.pid ? ', pid ' + d.pid : ''})\n`)
    else console.log('  No running Moqui found and run-script fallback failed — start Moqui, then refresh.\n')
  })
})

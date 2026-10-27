import type { LogEvent, LoggerHook } from "vue-logger-plugin";

// Persists every log line the app emits to IndexedDB so a device we cannot reach
// can still be inspected after the fact (DxpLogsModal reads it back). Console output
// is lost on reload and a remote collector needs a network path; this survives both.
//
// Turned on per app through the logger: `.use(logger, { persistLogs: true })`. The
// hook runs as an afterHook, so it only ever sees lines RedactSensitiveDataHook has
// already cleaned.
//
// Two rules hold throughout this file: nothing here may throw into the calling
// code path, and nothing here may call logger.* — that would re-enter this hook
// and recurse. Failures are swallowed on purpose.

const STORE_NAME = "entries";
const DB_VERSION = 1;

// Each app runs on its own origin, so one name per origin is enough. An app that
// already kept logs under another name passes it as `dbName` to keep that history.
const DEFAULT_DB_NAME = "app-logs";

// Roughly a few days of normal use. Old entries are dropped rather than growing
// without bound on a device that is never cleared.
const DEFAULT_MAX_ENTRIES = 2000;
const TRIM_EVERY = 50;

export interface LogRecord {
  id?: number;
  time: number;
  level: string;
  message: string;
  caller?: string;
}

export interface LogStoreOptions {
  dbName?: string;
  maxEntries?: number;
}

const config = {
  // Set once the app turns persistence on, so screens only offer the logs when there are some to show
  isEnabled: false,
  dbName: DEFAULT_DB_NAME,
  maxEntries: DEFAULT_MAX_ENTRIES
}

let dbPromise: Promise<IDBDatabase> | null = null;
let writesSinceTrim = 0;

/** Called by the logger's install with the app's `persistLogs` options, before anything is written. */
function configure(options: LogStoreOptions = {}) {
  const dbName = options.dbName || DEFAULT_DB_NAME;
  if(dbName !== config.dbName) {dbPromise = null;}

  config.isEnabled = true;
  config.dbName = dbName;
  config.maxEntries = options.maxEntries && options.maxEntries > 0 ? options.maxEntries : DEFAULT_MAX_ENTRIES;
}

function openDb(): Promise<IDBDatabase> {
  if(dbPromise) {return dbPromise;}

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if(typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));

      return;
    }

    const request = indexedDB.open(config.dbName, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if(!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("time", "time");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // A failed open must not be cached, otherwise one transient failure disables
  // logging for the whole session.
  promise.catch(() => { if(dbPromise === promise) {dbPromise = null;} });

  dbPromise = promise;

  return promise;
}

function runTransaction(mode: "readonly" | "readwrite", work: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then((db) => new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    work(transaction.objectStore(STORE_NAME));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  }));
}

// Drops the oldest entries once the store outgrows maxEntries. Runs occasionally
// rather than on every write, since counting costs a full transaction.
async function trim() {
  const db = await openDb();

  const total = await new Promise<number>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if(total <= config.maxEntries) {return;}

  let remaining = total - config.maxEntries;

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).index("time").openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if(!cursor || remaining <= 0) {return;}
      cursor.delete();
      remaining -= 1;
      cursor.continue();
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function serialise(args: any[]) {
  return (args || []).map((arg) => {
    if(typeof arg === "string") {return arg;}

    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(" ");
}

async function append(record: LogRecord) {
  await runTransaction("readwrite", (store) => { store.add(record); });

  writesSinceTrim += 1;
  if(writesSinceTrim >= TRIM_EVERY) {
    writesSinceTrim = 0;
    await trim();
  }
}

/** Most recent entries first. Resolves to an empty list when storage is unavailable. */
async function readLogs(limit = 500): Promise<LogRecord[]> {
  try {
    const db = await openDb();

    return await new Promise<LogRecord[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly")
        .objectStore(STORE_NAME)
        .index("time")
        .openCursor(null, "prev");

      const records: LogRecord[] = [];

      request.onsuccess = () => {
        const cursor = request.result;
        if(!cursor || records.length >= limit) {return resolve(records);}
        records.push(cursor.value as LogRecord);
        cursor.continue();
      };

      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

async function clearLogs() {
  try {
    await runTransaction("readwrite", (store) => { store.clear(); });
  } catch {
    // Nothing useful to do, and logging here would recurse
  }
}

const logStoreHook: LoggerHook = {
  run(event: LogEvent) {
    try {
      // Fire and forget: the caller must never wait on storage, nor see it fail.
      void append({
        time: Date.now(),
        level: String(event.level),
        message: serialise(event.argumentArray),
        caller: event.caller
          ? `${event.caller.fileName ?? ""}:${event.caller.lineNumber ?? ""} ${event.caller.functionName ?? ""}`.trim()
          : undefined
      }).catch(() => { /* never surface a logging failure */ });
    } catch {
      // never surface a logging failure
    }
  }
}

export const logStore = {
  configure,
  logStoreHook,
  readLogs,
  clearLogs,
  serialise,
  get isEnabled() { return config.isEnabled; },
  get maxEntries() { return config.maxEntries; }
}

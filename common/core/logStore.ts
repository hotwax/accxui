import Dexie, { type Table } from "dexie";
import type { LogEvent, LoggerHook } from "vue-logger-plugin";
import { cookieHelper } from "../helpers/cookieHelper";

// Persists every log line the app emits to IndexedDB so a device we cannot reach
// can still be inspected after the fact (DxpLogsModal reads it back). Console output
// is lost on reload and a remote collector needs a network path; this survives both.
//
// The logger installs it in every app as its last afterHook, so it only ever sees
// lines RedactSensitiveDataHook has already cleaned.
//
// This is a standalone Dexie database, not a table in the app db: the app db is per OMS
// instance and cleared on logout, while these logs must outlive a logout and a failed login.
//
// Two rules hold throughout this file: nothing here may throw into the calling
// code path, and nothing here may call logger.* — that would re-enter this hook
// and recurse. Failures are swallowed on purpose.

const DB_VERSION = 1;

// Each app runs on its own origin, so one name per origin is enough.
const DEFAULT_DB_NAME = "app-logs";

// Roughly a few days of normal use. Old entries are dropped rather than growing
// without bound on a device that is never cleared.
const DEFAULT_MAX_ENTRIES = 2000;
const TRIM_EVERY = 50;

// A stringified API error can carry a whole response body. Longer lines are cut so a couple of
// thousand entries cannot take a meaningful share of the device's storage.
const MAX_MESSAGE_LENGTH = 10_000;

export interface LogRecord {
  id?: number;
  time: number;
  level: string;
  message: string;
  caller?: string;
  // Who and where, only when a user was logged in as the line was written
  oms?: string;
  username?: string;
}

export interface LogStoreOptions {
  dbName?: string;
  maxEntries?: number;
}

class LogDb extends Dexie {
  entries!: Table<LogRecord, number>;

  constructor(dbName: string) {
    super(dbName);
    this.version(DB_VERSION).stores({ entries: "++id, time" });
  }
}

const config = {
  dbName: DEFAULT_DB_NAME,
  maxEntries: DEFAULT_MAX_ENTRIES
}

let db: LogDb | null = null;
// Starts one short of TRIM_EVERY so the first write of every page load trims. A page load that
// writes fewer than TRIM_EVERY lines would otherwise never trim, and with the usual "error" level
// most do, so the cap would stop holding on a device that reloads often.
let writesSinceTrim = TRIM_EVERY - 1;

/**
 * Points the store at another database or cap. The framework never calls it, so every app keeps the
 * defaults; it is here for tests and for an app that ever needs its own name.
 */
function configure(options: LogStoreOptions = {}) {
  const dbName = options.dbName || DEFAULT_DB_NAME;
  if(dbName !== config.dbName) {
    db?.close();
    db = null;
  }

  config.dbName = dbName;
  config.maxEntries = options.maxEntries && options.maxEntries > 0 ? options.maxEntries : DEFAULT_MAX_ENTRIES;
}

/**
 * Runs one piece of work against the log db, which Dexie opens on first use. A failed open is not
 * kept: the instance is dropped so the next call opens afresh, otherwise one transient failure
 * disables logging for the whole session.
 */
async function withDb<T>(work: (logDb: LogDb) => Promise<T>): Promise<T> {
  const logDb = db ?? (db = new LogDb(config.dbName));

  try {
    return await work(logDb);
  } catch (error) {
    if(!logDb.isOpen() && db === logDb) {db = null;}
    throw error;
  }
}

// Drops the oldest entries once the store outgrows maxEntries. Runs occasionally
// rather than on every write, since counting costs a full transaction.
function trim() {
  return withDb(async (logDb) => {
    const excess = await logDb.entries.count() - config.maxEntries;
    if(excess <= 0) {return;}

    const oldest = await logDb.entries.orderBy("time").limit(excess).primaryKeys();
    await logDb.entries.bulkDelete(oldest);
  });
}

function serialise(args: any[]) {
  const message = (args || []).map((arg) => {
    if(typeof arg === "string") {return arg;}

    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }).join(" ");

  return message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH)}… [truncated ${message.length - MAX_MESSAGE_LENGTH} characters]`
    : message;
}

/**
 * The OMS and username from the cookies useAuth keeps, as they are when the line is written; a cookie
 * that is not set leaves its field out. Read from the cookies rather than from useAuth itself: useAuth
 * logs, so importing it here would close an import cycle through the logger.
 */
function sessionDetails(): Pick<LogRecord, "oms" | "username"> {
  try {
    const cookies = cookieHelper();

    return {
      oms: cookies.get("oms") || undefined,
      username: cookies.get("userId") || undefined
    };
  } catch {
    // No document (a test or worker realm), or unreadable cookies: store the line without them
    return {};
  }
}

async function append(record: LogRecord) {
  await withDb((logDb) => logDb.entries.add(record));

  writesSinceTrim += 1;
  if(writesSinceTrim >= TRIM_EVERY) {
    writesSinceTrim = 0;
    await trim();
  }
}

/** Most recent entries first. Resolves to an empty list when storage is unavailable. */
async function readLogs(limit = 500): Promise<LogRecord[]> {
  try {
    return await withDb((logDb) => logDb.entries.orderBy("time").reverse().limit(limit).toArray());
  } catch {
    return [];
  }
}

/** Every stored entry, oldest first, for a download. Resolves to an empty list when storage is unavailable. */
async function readAllLogs(): Promise<LogRecord[]> {
  try {
    return await withDb((logDb) => logDb.entries.orderBy("time").toArray());
  } catch {
    return [];
  }
}

async function clearLogs() {
  try {
    await withDb((logDb) => logDb.entries.clear());
  } catch {
    // Nothing useful to do, and logging here would recurse
  }
}

const logStoreHook: LoggerHook = {
  run(event: LogEvent) {
    try {
      append({
        time: Date.now(),
        level: String(event.level),
        message: serialise(event.argumentArray),
        caller: event.caller
          ? `${event.caller.fileName ?? ""}:${event.caller.lineNumber ?? ""} ${event.caller.functionName ?? ""}`.trim()
          : undefined,
        ...sessionDetails()
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
  readAllLogs,
  clearLogs,
  serialise,
  sessionDetails,
  get maxEntries() { return config.maxEntries; }
}

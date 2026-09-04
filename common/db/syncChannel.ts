/**
 * Name of the BroadcastChannel the sync worker uses to announce that rows changed.
 *
 * A constant rather than a repeated literal: the worker, the status composable, and each app's
 * seed store all listen on this channel, and a mismatch between them fails silently — no error,
 * the UI just stops seeing new rows. Importing the name makes a stale copy a build error instead.
 */
export const DB_SYNC_CHANNEL = "hotwax-db-sync";

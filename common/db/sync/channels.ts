/**
 * BroadcastChannel names and helpers shared by the main thread and the sync worker.
 */

/**
 * Name of the BroadcastChannel the sync worker uses to announce that rows changed.
 *
 * A constant rather than a repeated literal: the worker, the status composable, and each app's
 * seed store all listen on this channel, and a mismatch between them fails silently — no error,
 * the UI just stops seeing new rows. Importing the name makes a stale copy a build error instead.
 */
export const DB_SYNC_CHANNEL = "hotwax-db-sync";

/**
 * Framework token-broadcast channel for the worker polling service.
 *
 * A Web Worker is a separate realm and cannot read the in-memory bearer token
 * (`commonUtil.getToken()` resolves on the main thread only). Rather than snapshot the token
 * once at start (which goes stale on rotation), the main thread PUBLISHES the current token
 * over a BroadcastChannel and the worker HOLDS the latest — event-driven, never frozen.
 */
export const POLLING_TOKEN_CHANNEL = "accxui:polling-auth-token";

export interface TokenMessage {
  token: string;
}

/** Main thread: a publisher you post the current token to whenever it changes. */
export function createTokenPublisher(channelName = POLLING_TOKEN_CHANNEL): { publish: (token: string) => void; close: () => void } {
  const bc = new BroadcastChannel(channelName);
  return {
    publish: (token: string) => bc.postMessage({ token } as TokenMessage),
    close: () => bc.close(),
  };
}

/** Worker: subscribe to token pushes. Returns an unsubscribe function. */
export function subscribeToken(onToken: (token: string) => void, channelName = POLLING_TOKEN_CHANNEL): () => void {
  const bc = new BroadcastChannel(channelName);
  bc.onmessage = (event: MessageEvent<TokenMessage>) => {
    if (event.data?.token) onToken(event.data.token);
  };
  return () => bc.close();
}

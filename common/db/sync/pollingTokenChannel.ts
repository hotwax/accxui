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

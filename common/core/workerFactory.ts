import * as Comlink from 'comlink';

export const WorkerFactory = {
  /**
   * Spawns a worker using a pre-resolved URL.
   * @param workerUrl - The result of new URL('path', import.meta.url)
   */
  createWorker<T>(workerUrl: URL) {
    const worker = new Worker(workerUrl, {
      type: 'module',
    });

    // Wrap the worker thread with Comlink for easy async calls
    const api = Comlink.wrap<T>(worker);
    
    // Extract the filename from the URL for clean logging
    // Example: "/src/workers/data.worker.ts" -> "data.worker.ts"
    const workerName = workerUrl.pathname.split('/').pop() || 'UnknownWorker';
    
    return {
      api,
      terminate: () => {
        worker.terminate();
        console.log(`[WorkerFactory] ${workerName} terminated.`);
      },
      worker // The raw worker instance for low-level events
    };
  }
};
/* 
Inside your Ionic Page
const worker = WorkerFactory.createWorker<MyAPI>(
  new URL('../workers/heavy-logic.worker.ts', import.meta.url)
);

// When you navigate away or call:
worker.terminate();
*/
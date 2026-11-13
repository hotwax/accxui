import path from 'node:path';
/** Development-only fixtures. Uses the normal app entry, router and components. */
export function localMockPlugin(appRoot: string) {
  return {
    name: 'local-ui-fixtures', enforce: 'pre' as const,
    resolveId(source: string) {
      if (/(?:^|\/)useAuth(?:\.ts)?$/.test(source)) return path.join(appRoot, 'src/mocks/auth.ts');
      if (/(?:^|\/)remoteApi(?:\.ts)?$/.test(source)) return path.join(appRoot, 'src/mocks/api.ts');
      if (/(?:^|\/)appDbSync(?:\.ts)?$/.test(source)) return path.join(appRoot, 'src/mocks/appDbSync.ts');
    }
  };
}

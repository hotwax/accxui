import { execSync } from 'child_process';

/**
 * Generates version information for the application using git and package data.
 * This utility is intended for use in build scripts (e.g., vite.config.ts) and
 * uses Node.js 'child_process'. Do not import this in browser-side code.
 * 
 * @param packageVersion The version from the app's package.json
 * @returns An object containing version details
 */
const getVersionInfo = (packageVersion: string) => {
  const appVersionInfo = {
    version: packageVersion,
    branch: '',
    tag: '',
    revision: '',
    builtTime: Date.now()
  };

  const executeCommand = (command: string) => {
    try {
      return execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch (err) {
      return '';
    }
  };

  // Extract branch
  appVersionInfo.branch = executeCommand('git symbolic-ref --short -q HEAD');

  // Extract tag
  appVersionInfo.tag = executeCommand('git describe --tags --exact-match');

  // Extract revision (short commit hash)
  appVersionInfo.revision = executeCommand('git rev-parse --short HEAD');

  return appVersionInfo;
}

export const versionInfoUtil = {
  getVersionInfo
}

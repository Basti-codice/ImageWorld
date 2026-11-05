import { installMockApi } from './mock';

/** Installs the in-memory mock when running outside Electron (plain browser dev / screenshots). */
export function ensureApi() {
  if (!window.api) installMockApi();
}

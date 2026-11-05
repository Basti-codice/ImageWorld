// OneDrive "Files On-Demand": detect online-only placeholders without triggering a download (Windows only, best effort).
import { spawn } from 'node:child_process';
import { warn } from './util';

export class CloudChecker {
  readonly supported = process.platform === 'win32';

  /** Lower-cased absolute paths of all files below `root` carrying the Offline attribute; null when unavailable. */
  offlineFiles(root: string): Promise<Set<string> | null> {
    if (!this.supported) return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const set = new Set<string>();
        const p = spawn('cmd.exe', ['/d', '/s', '/c', `chcp 65001>nul & dir /a:O /b /s "${root.replace(/"/g, '')}"`], {
          windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'ignore'],
        });
        let rest = '';
        p.stdout.setEncoding('utf8');
        p.stdout.on('data', (c: string) => {
          rest += c;
          let i: number;
          while ((i = rest.indexOf('\n')) >= 0) {
            const line = rest.slice(0, i).replace(/\r$/, '');
            rest = rest.slice(i + 1);
            if (line) set.add(line.toLowerCase());
          }
        });
        const timer = setTimeout(() => { p.kill(); resolve(null); }, 10 * 60_000);
        p.on('error', () => { clearTimeout(timer); resolve(null); });
        p.on('close', (code) => {
          clearTimeout(timer);
          if (rest.trim()) set.add(rest.trim().toLowerCase());
          // "File Not Found" (nothing offline) exits with 1 and prints nothing on stdout
          resolve(code === 0 || code === 1 ? set : null);
        });
      } catch (e) {
        warn('cloud check failed', e);
        resolve(null);
      }
    });
  }

  /** true when this single file is an online-only placeholder */
  isOffline(file: string): Promise<boolean> {
    if (!this.supported) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        const p = spawn('cmd.exe', ['/d', '/s', '/c', `dir /a:O /b "${file.replace(/"/g, '')}"`], {
          windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'ignore'],
        });
        let out = '';
        p.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); });
        const timer = setTimeout(() => { p.kill(); resolve(false); }, 8000);
        p.on('error', () => { clearTimeout(timer); resolve(false); });
        p.on('close', () => { clearTimeout(timer); resolve(out.trim().length > 0); });
      } catch {
        resolve(false);
      }
    });
  }
}

import type { ReactNode } from 'react';
import { norm } from '@/lib/filter';

/** Wraps the parts of `text` that match any token (case/accent-insensitive, at word starts or inside) in <mark>. */
export function highlight(text: string, tokens: string[]): ReactNode {
  if (!tokens.length || !text) return text;
  // normalise char-by-char so indices stay aligned with the original string
  let n = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) { const c = norm(text[i]); for (let k = 0; k < c.length; k++) map.push(i); n += c; }
  const hit = new Uint8Array(text.length);
  let any = false;
  for (const tok of tokens) {
    if (!tok) continue;
    let from = 0;
    for (;;) {
      const i = n.indexOf(tok, from); if (i < 0) break;
      const wordStart = i === 0 || /[^\p{L}\p{N}]/u.test(n[i - 1]);
      if (wordStart || tok.length >= 4) { for (let k = i; k < i + tok.length; k++) hit[map[k]] = 1; any = true; }
      from = i + tok.length;
    }
  }
  if (!any) return text;
  const out: ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    let j = i; const on = hit[i] === 1;
    while (j < text.length && (hit[j] === 1) === on) j++;
    out.push(on ? <mark key={i}>{text.slice(i, j)}</mark> : text.slice(i, j));
    i = j;
  }
  return out;
}

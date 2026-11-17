/**
 * Helpers for porting the Claude Design landing exactly: the design's inline style strings are
 * pasted verbatim and turned into React style objects; `style-hover` / `style-focus` become `h` / `f`.
 */
import { createElement, useState, type CSSProperties, type ReactNode } from 'react';

const cache = new Map<string, CSSProperties>();
const camel = (p: string) => p.trim().replace(/^-(webkit|moz|ms)-/, (_, v: string) => v[0].toUpperCase() + v.slice(1) + '-').replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** "a:b;c-d:e" → { a: 'b', cD: 'e' }. Splits declarations on ';' and each on its first ':' only (URLs keep their colons). */
export function css(s: string): CSSProperties {
  const hit = cache.get(s);
  if (hit) return hit;
  const o: Record<string, string> = {};
  for (const decl of s.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim();
    if (!k) continue;
    o[k.startsWith('--') ? k : camel(k)] = decl.slice(i + 1).trim();
  }
  cache.set(s, o as CSSProperties);
  return o as CSSProperties;
}

type HProps = { t?: string; s: string; h?: string; f?: string; children?: ReactNode; [k: string]: unknown };

/**
 * A hover or focus style that changes border-color over a base `border: 1px solid …` would make React mix the
 * shorthand and a longhand (a dev warning, and a real styling bug on rerender). In that case the base border is
 * written as its three longhands instead.
 */
function longhandBorder(base: ReturnType<typeof css>, overlays: (string | undefined)[]) {
  const b = (base as Record<string, unknown>).border;
  const touched = overlays.some((o) => o && /(^|;)\s*border-(color|width|style)\s*:/.test(o));
  const parts = typeof b === 'string' ? b.trim().split(/\s+(?![^(]*\))/) : [];
  if (!touched || parts.length !== 3) return base;
  const { border: _border, ...rest } = base as Record<string, unknown>;
  return { ...rest, borderWidth: parts[0], borderStyle: parts[1], borderColor: parts[2] } as ReturnType<typeof css>;
}

/** An element with the design's base style `s`, plus hover `h` and focus `f` styles layered on top. */
export function H({ t = 'div', s, h, f, children, ...rest }: HProps) {
  const [hov, setHov] = useState(false);
  const [foc, setFoc] = useState(false);
  const style = { ...longhandBorder(css(s), [h, f]), ...(hov && h ? css(h) : {}), ...(foc && f ? css(f) : {}) };
  const p: Record<string, unknown> = { ...rest, style };
  if (h) {
    const me = rest.onMouseEnter as ((e: unknown) => void) | undefined;
    const ml = rest.onMouseLeave as ((e: unknown) => void) | undefined;
    p.onMouseEnter = (e: unknown) => { setHov(true); me?.(e); };
    p.onMouseLeave = (e: unknown) => { setHov(false); ml?.(e); };
  }
  if (f) {
    p.onFocus = () => setFoc(true);
    p.onBlur = () => setFoc(false);
  }
  return createElement(t, p, children);
}

import { useEffect, useState } from 'react';

/** The header timer. Lives outside React so it keeps running across route changes. */
type State = { run: boolean; since: number; acc: number };
let st: State = { run: false, since: 0, acc: 0 };
const subs = new Set<() => void>();
const stopSubs = new Set<(hours: number) => void>();
let iv: number | undefined;
const emit = () => subs.forEach((s) => s());

export const timer = {
  start() {
    if (st.run) return;
    st = { ...st, run: true, since: Date.now() };
    window.clearInterval(iv);
    iv = window.setInterval(emit, 1000);
    emit();
  },
  pause() {
    if (!st.run) return;
    window.clearInterval(iv);
    st = { run: false, since: 0, acc: st.acc + (Date.now() - st.since) };
    emit();
  },
  /** Stops and hands the elapsed time, rounded to the quarter hour (minimum 0.25 h), to the grid. */
  stop() {
    const ms = st.acc + (st.run ? Date.now() - st.since : 0);
    window.clearInterval(iv);
    st = { run: false, since: 0, acc: 0 };
    const add = Math.max(0.25, Math.round(ms / 900000) * 0.25);
    stopSubs.forEach((f) => f(add));
    emit();
  },
  onStop(f: (hours: number) => void) {
    stopSubs.add(f);
    return () => { stopSubs.delete(f); };
  },
};

export function useTimer() {
  const [, set] = useState(0);
  useEffect(() => {
    const f = () => set((x) => x + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  const ms = st.acc + (st.run ? Date.now() - st.since : 0);
  const sec = Math.floor(ms / 1000);
  const pad = (x: number) => String(x).padStart(2, '0');
  return { running: st.run, ms, label: pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor(sec / 60) % 60) + ':' + pad(sec % 60) };
}

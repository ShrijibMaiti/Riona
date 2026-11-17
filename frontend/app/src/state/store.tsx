import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockColour } from '../data/selectors/blocks';
import type { Role } from '../data/types';

/** UI settings (the prototype's tweaks), from the URL: ?blocks=Ember&dropdown=click&org=Acme */
export type Settings = { blockColour: BlockColour; dropdownTrigger: 'hover' | 'click'; orgName: string };

const params = new URLSearchParams(location.search);
const pick = <T extends string>(v: string | null, opts: readonly T[], d: T): T => (opts.includes(v as T) ? (v as T) : d);
const SETTINGS: Settings = {
  blockColour: pick(params.get('blocks'), ['Violet', 'Ember', 'Mono'] as const, 'Violet'),
  dropdownTrigger: pick(params.get('dropdown'), ['hover', 'click'] as const, 'hover'),
  orgName: params.get('org') || 'Kestrel Digital',
};

/**
 * Go to `url` with a full page load, even when only the #hash differs (which browsers treat as in-page
 * navigation). Used on sign-in and sign-out, so nothing cached from the previous session survives.
 */
export function loadFresh(url: string) {
  const [base, hash = ''] = url.split('#');
  if (base === location.pathname + location.search) {
    location.hash = hash;
    location.reload();
  } else location.href = url;
}

// ---- hash routing ----
export const readHash = () => (location.hash || '').replace(/^#/, '') || '/';
export const go = (path: string) => {
  location.hash = '#' + path;
};
/** Path and query parts of the hash route. */
export function useRoute() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const on = () => {
      const r = readHash();
      setRoute((prev) => {
        if (prev.split('?')[0] !== r.split('?')[0]) window.scrollTo(0, 0);
        return r;
      });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const queryOf = (route: string) => new URLSearchParams(route.split('?')[1] ?? '');

type Ctx = {
  settings: Settings;
  role: Role;
  /** Preview the app as another role. In-memory build only; against the API the role is the session's. */
  /** Adopt the role GET /me reports (App.tsx's session gate, API builds). */
  adoptSessionRole: (r: Role) => void;
  rejectFor: string | null;
  askReject: (id: string | null) => void;
  toast: string | null;
  say: (t: string) => void;
};
const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  // The role is the signed-in account's: the shell waits for GET /me (App.tsx) and starts from the least-privileged
  // role until then, so nothing an employee shouldn't see flashes up.
  const [role, setRoleState] = useState<Role>('Employee');
  const [rejectFor, askReject] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const tt = useRef<number>();

  const say = useCallback((t: string) => {
    window.clearTimeout(tt.current);
    setToast(t);
    tt.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  const adoptSessionRole = useCallback((r: Role) => setRoleState(r), []);
  const value = useMemo(() => ({ settings: SETTINGS, role, adoptSessionRole, rejectFor, askReject, toast, say }), [role, adoptSessionRole, rejectFor, toast, say]);
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

export function useMediaWide(min = 1024) {
  const [wide, setWide] = useState(() => window.innerWidth >= min);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= min);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [min]);
  return wide;
}

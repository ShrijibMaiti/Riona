import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { TopBar, type Panels } from './components/TopBar';
import { Notifications, useNotifRows } from './components/Notifications';
import { AccountMenu } from './components/AccountMenu';
import { CommandPalette } from './components/CommandPalette';
import { MobileMenu, RejectModal, Toast } from './components/Overlays';
import { Breadcrumbs } from './screens/NotFound';
import { AppRoute } from './routes';
import { useClients, useEmployees, useMe, useProjects } from './hooks/data';
import { queryOf, useApp, useMediaWide, useRoute } from './state/store';
import { UNAUTHORIZED_EVENT } from './data/repositories/http/client';
import { ErrorState } from './components/ui';

const CLOSED: Panels = { dd: null, notif: false, avatar: false, palette: false, menu: false };

/** Resolve record ids in the path to names for breadcrumbs. */
function useCrumbNames() {
  const e = useEmployees(), p = useProjects(), c = useClients();
  return useMemo(() => {
    const o: Record<string, string> = {};
    e.data?.forEach((x) => (o[x.id] = x.name));
    p.data?.forEach((x) => (o[x.id] = x.name));
    c.data?.forEach((x) => (o[x.id] = x.name));
    return o;
  }, [e.data, p.data, c.data]);
}

const PublicSite = lazy(() => import('./public/PublicSite'));
const Portal = lazy(() => import('./portal/Portal'));
const Auth = {
  Login: lazy(() => import('./public/Auth').then((m) => ({ default: m.LoginPage }))),
  Forgot: lazy(() => import('./public/Auth').then((m) => ({ default: m.ForgotPage }))),
  Setup: lazy(() => import('./public/Auth').then((m) => ({ default: m.SetupWizard }))),
  Reset: lazy(() => import('./public/Auth').then((m) => ({ default: m.ResetPage }))),
};

/** Three apps share one bundle entry: the public site, the client portal and the internal app. */
export function App() {
  const route = useRoute();
  const path = (route.split('?')[0].replace(/\/$/, '') || '/');
  const seg = path.split('/').filter(Boolean);
  useSessionEndsToLogin();
  if (seg[0] === 'app') return <Session><InternalApp route={route} /></Session>;
  let page;
  if (seg[0] === 'portal') page = <Portal path={path} />;
  else if (seg[0] === 'login') page = <Auth.Login />;
  else if (seg[0] === 'forgot-password') page = <Auth.Forgot />;
  else if (seg[0] === 'setup') page = <Auth.Setup key={seg[1] ?? ''} token={seg[1] ?? ''} />;
  else if (seg[0] === 'reset-password') page = <Auth.Reset key={seg[1] ?? ''} token={seg[1] ?? ''} />;
  else page = <PublicSite path={path} />;
  return <Suspense fallback={<div aria-busy="true" style={{ minHeight: '100vh' }} />}>{page}</Suspense>;
}

/** Any 401 from the API (session expired, signed out elsewhere) sends the person back to sign-in. */
function useSessionEndsToLogin() {
  useEffect(() => {
    const onUnauthorized = () => {
      if (!location.hash.startsWith('#/login')) location.hash = '#/login';
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);
}

/**
 * Against the API the internal app waits for GET /me: its role decides which hubs exist, so rendering before
 * it would flash the wrong navigation. (A 401 here goes to sign-in, above.) The in-memory build knows its role
 * from ?role= already.
 */
function Session({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const { role, adoptSessionRole } = useApp();
  const sessionRole = me.data?.role;
  useEffect(() => {
    if (sessionRole) adoptSessionRole(sessionRole);
  }, [sessionRole, adoptSessionRole]);
  // A client account opening the internal app belongs in its portal.
  const portalOnly = (me.error as { code?: string } | null)?.code === 'portal.only';
  useEffect(() => {
    if (portalOnly) location.hash = '#/portal';
  }, [portalOnly]);
  if (portalOnly) return <div aria-busy="true" style={{ minHeight: '100vh' }} />;
  if (me.error) return <div className="wrap page"><ErrorState error={me.error} retry={me.refetch} /></div>;
  if (!me.data || role !== me.data.role) return <div aria-busy="true" style={{ minHeight: '100vh' }} />;
  return <>{children}</>;
}

function InternalApp({ route }: { route: string }) {
  const wide = useMediaWide();
  const { askReject, settings } = useApp();
  const [panels, setPanelState] = useState<Panels>(CLOSED);
  const setPanels = useCallback((p: Partial<Panels>) => setPanelState((s) => ({ ...s, ...p })), []);
  const notifRows = useNotifRows();
  const names = useCrumbNames();

  const [pathPart] = route.split('?');
  const path = pathPart.replace(/\/$/, '') || '/app';
  const query = queryOf(route);
  const seg = path.split('/').filter(Boolean);

  useEffect(() => setPanelState(CLOSED), [path]);
  useEffect(() => { if (wide) setPanels({ menu: false }); }, [wide, setPanels]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPanelState((s) => ({ ...s, palette: !s.palette, notif: false, avatar: false }));
      } else if (e.key === 'Escape') {
        setPanelState(CLOSED);
        askReject(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askReject]);

  const anyPanel = panels.notif || panels.avatar || (panels.dd !== null && settings.dropdownTrigger === 'click');

  return (
    <>
      <TopBar route={path} wide={wide} panels={panels} setPanels={setPanels} hasUnread={!!notifRows?.some((n) => n.unread)} />
      {anyPanel && <div className="scrim" onClick={() => setPanels({ notif: false, avatar: false, dd: null })} />}
      {panels.notif && <Notifications rows={notifRows} />}
      {panels.avatar && <AccountMenu close={() => setPanels({ avatar: false })} />}
      {panels.palette && <CommandPalette close={() => setPanels({ palette: false })} />}
      {panels.menu && !wide && <MobileMenu />}
      <RejectModal />
      <Toast />

      <div style={{ height: 64 }} />
      {seg.length > 1 && <Breadcrumbs seg={seg} names={names} />}
      <main key={path}>
        <AppRoute path={path} query={query} />
      </main>
    </>
  );
}

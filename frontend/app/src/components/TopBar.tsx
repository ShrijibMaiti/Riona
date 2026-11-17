import { useRef, type MouseEvent } from 'react';
import { HUBS, ROLE_NAV, type NavKey } from '../config/hubs';
import { initials } from '../lib/format';
import { Wordmark, shortcutLabel } from './Brand';
import { useMe } from '../hooks/data';
import { useApp } from '../state/store';

export type Panels = { dd: NavKey | null; notif: boolean; avatar: boolean; palette: boolean; menu: boolean };

type Props = {
  route: string;
  wide: boolean;
  panels: Panels;
  setPanels: (p: Partial<Panels>) => void;
  hasUnread: boolean;
};

export function TopBar({ route, wide, panels, setPanels, hasUnread }: Props) {
  const { role, settings } = useApp();
  const me = useMe();
  const seg = route.split('/').filter(Boolean);
  const hubKey = seg[1] || 'dashboard';
  const timer = useRef<number>();
  const clickMode = settings.dropdownTrigger === 'click';

  const enter = (k: NavKey) => {
    window.clearTimeout(timer.current);
    if (clickMode || k === 'dashboard') return;
    timer.current = window.setTimeout(() => setPanels({ dd: k }), 150);
  };
  const leave = () => {
    window.clearTimeout(timer.current);
    if (!clickMode && panels.dd) setPanels({ dd: null });
  };

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          <Wordmark href="#/app" />
          {!wide && (
            <button className="menu-btn" onClick={() => setPanels({ menu: !panels.menu })}>
              Menu
            </button>
          )}
        </div>

        <div style={{ height: 64, display: 'flex' }}>
          {wide && (
            <nav className="nav" aria-label="Hubs">
              {ROLE_NAV[role].map((k) => {
                const H = k === 'dashboard' ? { label: 'Dashboard', path: '/app', modules: [] } : HUBS[k];
                const active = k === 'dashboard' ? seg.length === 1 : hubKey === k;
                const open = panels.dd === k && k !== 'dashboard';
                const onClick = (e: MouseEvent) => {
                  window.clearTimeout(timer.current);
                  if (clickMode && k !== 'dashboard' && !open) {
                    e.preventDefault();
                    setPanels({ dd: k });
                    return;
                  }
                  setPanels({ dd: null });
                };
                return (
                  <div key={k} className="nav-item" onMouseEnter={() => enter(k)} onMouseLeave={leave}>
                    <a href={'#' + H.path} onClick={onClick} className={'nav-link' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined}>
                      {H.label}
                    </a>
                    {open && (
                      <div className="dropdown">
                        {H.modules.map((m) => (
                          <a key={m.href} href={'#' + m.href} className="dropdown-item" onClick={() => setPanels({ dd: null })}>
                            <b>{m.name}</b>
                            <span>{m.tagline}</span>
                          </a>
                        ))}
                        <div className="dropdown-foot">
                          <a href={'#' + H.path} onClick={() => setPanels({ dd: null })}>
                            Open {H.label} overview →
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          )}
        </div>

        <div className="topbar-right">
          <button className="search-btn" onClick={() => setPanels({ palette: true })}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            {wide && <span className="label">Search or jump</span>}
            <span className="kbd">{shortcutLabel()}</span>
          </button>
          <button className="icon-btn" aria-label="Notifications" onClick={() => setPanels({ notif: !panels.notif, avatar: false })}>
            <svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M4.5 7.5a4.5 4.5 0 019 0c0 4 1.5 5.5 1.5 5.5H3s1.5-1.5 1.5-5.5z" />
              <path d="M7.5 15.5a1.6 1.6 0 003 0" />
            </svg>
            {hasUnread && <span className="unread-dot" />}
          </button>
          <button className="me-btn" aria-label="Account" onClick={() => setPanels({ avatar: !panels.avatar, notif: false })}>
            {me.data ? initials(me.data.employee.name) : ''}
          </button>
        </div>
      </div>
    </header>
  );
}

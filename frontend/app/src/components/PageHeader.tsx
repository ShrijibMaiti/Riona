import type { ReactNode } from 'react';
import { Menu, type MenuItem } from './Menu';

export type View = { label: string; href: string };

/** Title, description, overflow menu and primary action; optional view switch below. */
export function PageHeader({ title, desc, primary, more, views, current, aside }: {
  title: ReactNode; desc?: ReactNode;
  primary?: { label: string; onClick?: () => void; href?: string; disabled?: boolean };
  more?: MenuItem[]; views?: View[]; current?: string; aside?: ReactNode;
}) {
  return (
    <>
      <div className="ph">
        <div>
          <h1 className="display">{title}</h1>
          {desc && <p className="ph-desc">{desc}</p>}
        </div>
        <div className="ph-actions">
          {aside}
          {more && <Menu items={more} />}
          {primary && (primary.href
            ? <a className="btn-dark" href={'#' + primary.href}>{primary.label}</a>
            : <button className="btn-dark" onClick={primary.onClick} disabled={primary.disabled}>{primary.label}</button>)}
        </div>
      </div>
      {views && (
        <div className="viewseg" role="tablist">
          {views.map((v) => (
            <a key={v.href} href={'#' + v.href} role="tab" aria-selected={v.href === current} className={v.href === current ? 'active' : ''}>{v.label}</a>
          ))}
        </div>
      )}
    </>
  );
}

/** Underlined tab strip (profile, project, queues). */
export function Tabs({ tabs, current }: { tabs: { label: ReactNode; key: string; href?: string; onClick?: () => void; count?: number }[]; current: string }) {
  return (
    <div className="utabs" role="tablist">
      {tabs.map((t) => {
        const on = t.key === current;
        const body = <>{t.label}{t.count !== undefined && <span className="cnt">{t.count}</span>}</>;
        return t.href
          ? <a key={t.key} href={'#' + t.href} role="tab" aria-selected={on} className={on ? 'active' : ''}>{body}</a>
          : <button key={t.key} role="tab" aria-selected={on} className={on ? 'active' : ''} onClick={t.onClick}>{body}</button>;
      })}
    </div>
  );
}

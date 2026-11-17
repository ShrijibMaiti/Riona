import { useMe } from '../hooks/data';
import { loadFresh, useApp } from '../state/store';
import { logout } from '../data/repositories';

export function AccountMenu({ close }: { close: () => void }) {
  const { role, settings } = useApp();
  const me = useMe();
  return (
    <div className="popover account" role="menu">
      <div className="account-who">
        <b>{me.data?.employee.name ?? '…'}</b>
        <span>{role} · {me.data?.orgName ?? settings.orgName}</span>
      </div>
      <a href="#/app/me" className="menu-row" onClick={close}>My Space</a>
      {role === 'Admin' && <a href="#/app/admin" className="menu-row" onClick={close}>Admin</a>}
      <a href="#/app/me/profile" className="menu-row" onClick={close}>Settings</a>
      <a href="#/app/workplace/kb" className="menu-row" onClick={close}>Help</a>
      <button className="menu-row" style={{ color: 'var(--ink-3)' }} onClick={() => { close(); void signOut(); }}>
        Sign out
      </button>
    </div>
  );
}

/** End the session, then load the sign-in page fresh so nothing cached from this session survives. */
async function signOut() {
  try {
    await logout();
  } finally {
    loadFresh(location.pathname + '#/login');
  }
}

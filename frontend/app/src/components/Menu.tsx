import { useEffect, useRef, useState, type ReactNode } from 'react';

export type MenuItem = { label: string; run: () => void; danger?: boolean; hidden?: boolean };

/** A small popover menu anchored to its trigger. Closes on outside click or Escape. */
export function Menu({ items, trigger, align = 'right', label = 'More actions' }: { items: MenuItem[]; trigger?: ReactNode; align?: 'left' | 'right'; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const shown = items.filter((i) => !i.hidden);
  if (!shown.length) return null;
  return (
    <div className="menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      {trigger ? (
        <span onClick={() => setOpen((o) => !o)}>{trigger}</span>
      ) : (
        <button className="ovf-btn" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>···</button>
      )}
      {open && (
        <div className={'menu-pop ' + align} role="menu">
          {shown.map((i) => (
            <button key={i.label} role="menuitem" className={'menu-row' + (i.danger ? ' danger' : '')} onClick={() => { setOpen(false); i.run(); }}>
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

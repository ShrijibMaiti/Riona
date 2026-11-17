import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { initials } from '../lib/format';
import { useMediaWide } from '../state/store';
import { Menu, type MenuItem } from './Menu';
import { SkeletonRows, StatusLabel } from './ui';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sort?: (row: T) => string | number;
  align?: 'left' | 'right';
  /** Shown on the stacked mobile card (first three by default). */
  mobile?: boolean;
  hideable?: boolean;
  width?: number | string;
};

export type BulkAction<T> = { label: string; run: (rows: T[]) => void | Promise<void> };

type Props<T> = {
  rows: T[] | undefined;
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onOpen?: (row: T) => void;
  selectable?: boolean;
  bulk?: BulkAction<T>[];
  rowMenu?: (row: T) => MenuItem[];
  pageSize?: number;
  /** Shown when there are no rows. */
  empty?: { title: string; sub?: string; onClear?: () => void };
  showColumns?: boolean;
  onCloseColumns?: () => void;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  total?: number;
  minWidth?: number;
  rowClass?: (row: T) => string;
};

/**
 * The one table. Sort, select, hover actions, bulk bar, pagination, column visibility, skeleton and empty states.
 * Below 768px it renders stacked cards: three fields and a chevron.
 */
export function DataTable<T>({ rows, columns, rowKey, onOpen, selectable, bulk, rowMenu, pageSize = 25, empty, showColumns, onCloseColumns, initialSort, total, minWidth = 760, rowClass }: Props<T>) {
  const wide = useMediaWide(768);
  const [sort, setSort] = useState(initialSort);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!rows) return undefined;
    const col = columns.find((c) => c.key === sort?.key);
    if (!col?.sort || !sort) return rows;
    const m = sort.dir === 'desc' ? -1 : 1;
    return [...rows].sort((a, b) => {
      const x = col.sort!(a), y = col.sort!(b);
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * m;
    });
  }, [rows, columns, sort]);

  useEffect(() => setPage(1), [rows?.length]);
  const count = sorted?.length ?? 0;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  const pageRows = sorted?.slice((page - 1) * pageSize, page * pageSize);
  const visible = columns.filter((c) => !hidden[c.key]);
  const selected = sorted?.filter((r) => sel[rowKey(r)]) ?? [];
  const allOn = !!pageRows?.length && pageRows.every((r) => sel[rowKey(r)]);
  const toggleAll = () => {
    const n = { ...sel };
    pageRows?.forEach((r) => (n[rowKey(r)] = !allOn));
    setSel(n);
  };
  const mobileCols = (columns.some((c) => c.mobile) ? columns.filter((c) => c.mobile) : columns.slice(0, 3)).filter((c) => !hidden[c.key]);

  const header = (c: Column<T>) => {
    const on = sort?.key === c.key;
    const click = c.sort ? () => setSort({ key: c.key, dir: on && sort!.dir === 'asc' ? 'desc' : 'asc' }) : undefined;
    return (
      <th key={c.key} className={c.align === 'right' ? 'r' : ''} style={{ width: c.width }} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
        {click ? <button className="th-sort" onClick={click}>{c.header}{on ? (sort!.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button> : c.header}
      </th>
    );
  };

  const shownFrom = count ? (page - 1) * pageSize + 1 : 0;
  const shownTo = Math.min(count, page * pageSize);

  return (
    <>
      {showColumns && (
        <div className="colpick card" role="dialog" aria-label="Column visibility">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Columns</div>
          {columns.map((c, i) => (
            <label key={c.key} className="colpick-row">
              <input type="checkbox" disabled={i === 0 || c.hideable === false} checked={!hidden[c.key]} onChange={() => setHidden({ ...hidden, [c.key]: !hidden[c.key] })} />
              {c.header}
            </label>
          ))}
          <button className="text-btn" style={{ marginTop: 8 }} onClick={onCloseColumns}>Done</button>
        </div>
      )}
      {wide ? (
        <div className="tcard" onMouseLeave={() => setHover(null)}>
          <table className="dt" style={{ minWidth }}>
            <thead>
              <tr>
                {selectable && <th className="cb"><input type="checkbox" aria-label="Select all on this page" checked={allOn} onChange={toggleAll} /></th>}
                {visible.map(header)}
                <th style={{ width: 84 }} />
              </tr>
            </thead>
            {pageRows ? (
              <tbody>
                {pageRows.map((r) => {
                  const k = rowKey(r);
                  return (
                    <tr key={k} className={(onOpen ? 'clickable ' : '') + (rowClass?.(r) ?? '')} onClick={() => onOpen?.(r)} onMouseEnter={() => setHover(k)} onFocus={() => setHover(k)}>
                      {selectable && <td className="cb" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Select row" checked={!!sel[k]} onChange={() => setSel({ ...sel, [k]: !sel[k] })} /></td>}
                      {visible.map((c) => <td key={c.key} className={c.align === 'right' ? 'r' : ''}>{c.render(r)}</td>)}
                      <td className="acts">
                        <span className="row-acts" style={{ visibility: hover === k ? 'visible' : 'hidden' }}>
                          {rowMenu && <Menu items={rowMenu(r)} label="Row actions" />}
                          {onOpen && <span className="chev" aria-hidden>→</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ) : null}
          </table>
          {!pageRows && <SkeletonRows />}
          {pageRows && !pageRows.length && empty && (
            <div className="empty">
              <div className="empty-t">{empty.title}</div>
              {empty.sub && <div className="empty-s">{empty.sub}</div>}
              {empty.onClear && <button className="btn-line" style={{ marginTop: 20 }} onClick={empty.onClear}>Clear filters</button>}
            </div>
          )}
        </div>
      ) : (
        <div className="mcards">
          {!pageRows && <div className="card"><SkeletonRows n={4} /></div>}
          {pageRows?.map((r) => {
            const k = rowKey(r);
            return (
              <div key={k} className={'mcard' + (sel[k] ? ' on' : '')} onClick={() => onOpen?.(r)} role={onOpen ? 'link' : undefined}>
                {selectable && <input type="checkbox" aria-label="Select" checked={!!sel[k]} onClick={(e) => e.stopPropagation()} onChange={() => setSel({ ...sel, [k]: !sel[k] })} />}
                <div className="mcard-body">
                  {mobileCols.map((c, i) => (
                    <div key={c.key} className={i === 0 ? 'mcard-main' : 'mcard-sub'}>{i > 0 && <span className="mcard-k">{c.header}</span>}{c.render(r)}</div>
                  ))}
                </div>
                {onOpen && <span className="chev" aria-hidden>›</span>}
              </div>
            );
          })}
          {pageRows && !pageRows.length && empty && (
            <div className="card empty"><div className="empty-t">{empty.title}</div>{empty.onClear && <button className="btn-line" style={{ marginTop: 16 }} onClick={empty.onClear}>Clear filters</button>}</div>
          )}
        </div>
      )}
      <div className="tfoot">
        <span>{count ? 'Showing ' + shownFrom + '–' + shownTo + ' of ' + (total ?? count) : 'No records'}</span>
        {pages > 1 && (
          <div className="pager">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button disabled={page === pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
      {selectable && selected.length > 0 && (
        <div className="bulkbar" role="region" aria-label="Bulk actions">
          <span className="n">{selected.length} selected</span>
          {bulk?.map((b) => <button key={b.label} onClick={async () => { await b.run(selected); setSel({}); }}>{b.label}</button>)}
          <button className="clear" onClick={() => setSel({})}>Clear</button>
        </div>
      )}
    </>
  );
}

// ---- cell renderers from the design ----
export function PersonCell({ name, sub }: { name: string; sub?: string }) {
  return (
    <div className="pcell">
      <span className="pcell-av">{initials(name)}</span>
      <div style={{ minWidth: 0 }}><div className="pcell-n">{name}</div>{sub && <div className="cell-sub">{sub}</div>}</div>
    </div>
  );
}
export const Mono = ({ children }: { children: ReactNode }) => <span className="mono">{children}</span>;
export function TextCell({ text, sub }: { text: ReactNode; sub?: ReactNode }) {
  return <div style={{ minWidth: 0 }}><div className="nowrap">{text}</div>{sub && <div className="cell-sub">{sub}</div>}</div>;
}
export const Status = StatusLabel;
/** Ten small blocks filled to a percentage, as in the design's budget and progress columns. */
export function BlocksCell({ pct, text, colour = 'var(--violet)' }: { pct: number; text: string; colour?: string }) {
  const c = pct > 100 ? '#B4232F' : pct >= 90 ? '#A86F12' : colour;
  return (
    <div className="bcell">
      <div className="bcell-b">{Array.from({ length: 10 }, (_, i) => <span key={i} style={{ background: i < Math.round(Math.min(pct, 100) / 10) ? c : '#DFE1D7' }} />)}</div>
      <span>{text}</span>
    </div>
  );
}

/** Download rows as CSV. */
export function downloadCsv(name: string, header: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => '"' + String(v).replace(/"/g, '""') + '"';
  const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

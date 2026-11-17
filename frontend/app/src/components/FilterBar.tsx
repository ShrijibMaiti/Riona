export type FilterDef = { key: string; label: string; options: string[]; value: string; onChange: (v: string) => void };

/** One row: search, filter selects, then a scope select on the right. */
export function FilterBar({ search, onSearch, filters = [], scopes, scope, onScope, placeholder = 'Search' }: {
  search: string; onSearch: (v: string) => void; filters?: FilterDef[];
  scopes?: string[]; scope?: string; onScope?: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="fbar">
      <div className="fsearch">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#6F7268" strokeWidth="1.6" aria-hidden><circle cx="7" cy="7" r="5" /><path d="M11 11l3.5 3.5" /></svg>
        <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      </div>
      {filters.map((f) => (
        <select key={f.key} className="fselect" value={f.value} onChange={(e) => f.onChange(e.target.value)} aria-label={f.label}>
          <option value="">All {f.label.toLowerCase()}</option>
          {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
      <div className="fspacer" />
      {scopes && (
        <select className="fselect" value={scope} onChange={(e) => onScope?.(e.target.value)} aria-label="Records to show">
          {scopes.map((s) => <option key={s}>{s}</option>)}
        </select>
      )}
    </div>
  );
}

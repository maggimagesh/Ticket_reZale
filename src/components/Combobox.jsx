import { useId, useMemo, useRef, useState } from 'react';

function asOption(item) {
  if (item && typeof item === 'object') {
    return {
      label: item.label || item.title || item.value || '',
      value: item.value || item.title || item.label || '',
    };
  }
  return { label: String(item), value: String(item) };
}

/**
 * Type-ahead with a free-text escape hatch.
 * `options` may be strings or `{ label, value }` objects.
 * Set `filterLocal={false}` when the parent already ranked/fetched matches.
 */
export function Combobox({
  id,
  label,
  placeholder,
  value,
  onChange,
  options,
  emptyHint,
  limit = 8,
  filterLocal = true,
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const blurTimer = useRef(null);
  const listId = useId();

  const normalized = useMemo(() => (options || []).map(asOption), [options]);

  const hits = useMemo(() => {
    const list = normalized;
    if (!filterLocal) return list.slice(0, limit);
    const q = value.trim().toLowerCase();
    if (!q) return list.slice(0, limit);
    return list
      .filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q))
      .slice(0, limit);
  }, [normalized, value, limit, filterLocal]);

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const pick = (option) => {
    onChange(option.value);
    close();
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') return close();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      if (!hits.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + hits.length) % hits.length);
      return;
    }
    if (e.key === 'Enter' && open && active >= 0 && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    }
  };

  return (
    <div className="field" style={{ position: 'relative' }}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => {
          clearTimeout(blurTimer.current);
          setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(close, 120);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} className="listbox" role="listbox">
          {hits.length === 0 ? (
            <li className="listbox__empty">{emptyHint || 'No matches — you can still use this name.'}</li>
          ) : (
            hits.map((option, i) => (
              <li key={option.value + option.label} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  className="listbox__btn"
                  style={i === active ? { background: 'var(--surface2)' } : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(option)}
                >
                  {option.label}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

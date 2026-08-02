import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from './icons.jsx';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const SHOW_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
const SHOW_MINUTES = [0, 15, 30, 45];

const pad = (n) => String(n).padStart(2, '0');

function hourLabel(h) {
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${suffix}`;
}

/** Keep draft value as local `YYYY-MM-DDTHH:mm` (same as datetime-local). */
export function toLocalInputValue(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function parseLocalInputValue(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTrigger(value) {
  const d = parseLocalInputValue(value);
  if (!d) return '';
  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  let dayLabel;
  if (sameDay(d, today)) dayLabel = 'Today';
  else if (sameDay(d, tomorrow)) dayLabel = 'Tomorrow';
  else {
    dayLabel = d.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  const timeLabel = d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  return `${dayLabel} · ${timeLabel}`;
}

function buildMonthGrid(viewYear, viewMonth) {
  const first = new Date(viewYear, viewMonth, 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(viewYear, viewMonth, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function withDatePart(base, datePart) {
  const hour = base ? base.getHours() : 19;
  const minute = base ? base.getMinutes() : 0;
  const next = new Date(datePart);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function withTimePart(base, hour, minute) {
  const next = base ? new Date(base) : new Date();
  if (!base) {
    // Default date to today if only time picked first
    const today = startOfDay(new Date());
    next.setFullYear(today.getFullYear(), today.getMonth(), today.getDate());
  }
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function DateTimePicker({ id, label, value, onChange, minDate }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const listId = useId();
  const selected = parseLocalInputValue(value);
  const today = useMemo(() => startOfDay(new Date()), []);
  const min = minDate ? startOfDay(minDate) : today;

  const [view, setView] = useState(() => {
    const seed = selected || new Date();
    return { year: seed.getFullYear(), month: seed.getMonth() };
  });

  useEffect(() => {
    if (!open || !selected) return;
    setView({ year: selected.getFullYear(), month: selected.getMonth() });
  }, [open, selected]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const cells = useMemo(() => buildMonthGrid(view.year, view.month), [view.year, view.month]);
  const monthTitle = new Date(view.year, view.month, 1).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });

  const hour = selected ? selected.getHours() : 19;
  const minute = selected ? selected.getMinutes() - (selected.getMinutes() % 15) : 0;

  const shiftMonth = (delta) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  const pickDate = (day) => {
    if (startOfDay(day) < min) return;
    onChange(toLocalInputValue(withDatePart(selected, day)));
  };

  const pickTime = (h, m) => {
    onChange(toLocalInputValue(withTimePart(selected, h, m)));
  };

  const pickQuick = (offsetDays) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offsetDays);
    onChange(toLocalInputValue(withDatePart(selected, d)));
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  const display = formatTrigger(value);

  return (
    <div className="field dt" ref={rootRef}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>

      <button
        id={id}
        type="button"
        className={'dt__trigger focus-ring' + (open ? ' dt__trigger--open' : '')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={'dt__value' + (display ? '' : ' dt__value--placeholder')}>
          {display || 'Pick show date & time'}
        </span>
        <Calendar size={17} />
      </button>

      {open && (
        <div id={listId} className="dt__popover" role="dialog" aria-label="Choose show date and time">
          <div className="dt__quick">
            <button type="button" className="dt__chip focus-ring" onClick={() => pickQuick(0)}>
              Today
            </button>
            <button type="button" className="dt__chip focus-ring" onClick={() => pickQuick(1)}>
              Tomorrow
            </button>
            <button type="button" className="dt__chip focus-ring" onClick={() => pickQuick(7)}>
              Next week
            </button>
          </div>

          <div className="dt__monthbar">
            <button
              type="button"
              className="dt__nav focus-ring"
              aria-label="Previous month"
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <div className="dt__monthtitle">{monthTitle}</div>
            <button
              type="button"
              className="dt__nav focus-ring"
              aria-label="Next month"
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="dt__weekdays" aria-hidden="true">
            {WEEKDAYS.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>

          <div className="dt__grid" role="grid" aria-label={monthTitle}>
            {cells.map((day, i) => {
              if (!day) return <span key={`e-${i}`} className="dt__day dt__day--empty" />;
              const disabled = startOfDay(day) < min;
              const isSelected = selected && sameDay(day, selected);
              const isToday = sameDay(day, today);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  role="gridcell"
                  disabled={disabled}
                  aria-selected={isSelected}
                  className={
                    'dt__day focus-ring' +
                    (isSelected ? ' dt__day--selected' : '') +
                    (isToday && !isSelected ? ' dt__day--today' : '')
                  }
                  onClick={() => pickDate(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          <div className="dt__time">
            <div className="dt__timelabel">Show time</div>
            <div className="dt__timeselects">
              <label className="dt__selectwrap">
                <span className="sr-only">Hour</span>
                <select
                  className="dt__select"
                  value={hour}
                  onChange={(e) => pickTime(Number(e.target.value), minute)}
                >
                  {SHOW_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="dt__colon" aria-hidden="true">
                :
              </span>
              <label className="dt__selectwrap">
                <span className="sr-only">Minutes</span>
                <select
                  className="dt__select"
                  value={SHOW_MINUTES.includes(minute) ? minute : 0}
                  onChange={(e) => pickTime(hour, Number(e.target.value))}
                >
                  {SHOW_MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {pad(m)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="dt__slots" role="group" aria-label="Popular showtimes">
              {[
                [10, 0],
                [13, 0],
                [16, 30],
                [19, 0],
                [21, 30],
              ].map(([h, m]) => {
                const active = selected && selected.getHours() === h && selected.getMinutes() === m;
                const label = new Date(2000, 0, 1, h, m).toLocaleTimeString('en-IN', {
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                });
                return (
                  <button
                    key={`${h}:${m}`}
                    type="button"
                    className={'dt__slot focus-ring' + (active ? ' dt__slot--active' : '')}
                    onClick={() => pickTime(h, m)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="dt__footer">
            <button
              type="button"
              className="dt__clear focus-ring"
              onClick={() => {
                onChange('');
              }}
            >
              Clear
            </button>
            <button type="button" className="btn btn--primary btn--sm focus-ring" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tab switcher with a pill that slides behind the active option. */
export function SegmentedControl({ label, options, value, onChange, variant }) {
  const count = Math.max(1, options.length);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  return (
    <div
      className={'segmented' + (variant ? ' segmented--' + variant : '')}
      role="tablist"
      aria-label={label}
      style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}
      data-count={count}
    >
      <div
        className="segmented__pill"
        aria-hidden="true"
        style={{
          width: `calc(${100 / count}% - 4px)`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className="segmented__btn focus-ring"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

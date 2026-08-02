import { Minus, Plus } from './icons.jsx';

const SIZES = {
  sm: { cls: '', icon: 13 },
  lg: { cls: ' stepper--lg', icon: 14 },
  box: { cls: ' stepper--box', icon: 15 },
};

/**
 * Minus / value / plus. Clamps to [min, max] and disables the ends rather
 * than letting the value run out of range.
 */
export function QtyStepper({
  value,
  onChange,
  min = 0,
  max = Infinity,
  size = 'sm',
  decLabel = 'Decrease quantity',
  incLabel = 'Increase quantity',
  live = 'polite',
}) {
  const { cls, icon } = SIZES[size] ?? SIZES.sm;

  return (
    <div className={'stepper' + cls}>
      <button
        type="button"
        aria-label={decLabel}
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        className="stepper__btn focus-ring focus-ring--inset"
      >
        <Minus size={icon} />
      </button>
      <span className="stepper__value" aria-live={live}>
        {value}
      </span>
      <button
        type="button"
        aria-label={incLabel}
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        className="stepper__btn focus-ring focus-ring--inset"
      >
        <Plus size={icon} />
      </button>
    </div>
  );
}

import { Check, Cross } from './icons.jsx';

export function Toast({ title, body, onClose }) {
  return (
    <div className="toast" role="status" aria-live="polite">
      <div className="toast__icon">
        <Check size={15} color="var(--accent-text)" weight={2.4} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="toast__title">{title}</div>
        <div className="toast__body">{body}</div>
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onClose}
        className="toast__close focus-ring focus-ring--tight"
      >
        <Cross size={13} weight={2.4} />
      </button>
    </div>
  );
}

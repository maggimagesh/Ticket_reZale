/* Inline SVGs from the design file. All stroke icons sit on a 24×24 grid and
   inherit `currentColor` unless the design pinned a specific colour. */

const stroke = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function TicketMark({ size = 18, color = '#241802', perforated = true }) {
  return (
    <svg {...stroke} width={size} height={size} stroke={color} strokeWidth="2">
      <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 6 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-6z" />
      {perforated && <path d="M13 7v10" strokeDasharray="2 3" />}
    </svg>
  );
}

export function Spinner({ size = 16, color = 'currentColor' }) {
  return (
    <svg {...stroke} className="spin" width={size} height={size} stroke={color} strokeWidth="2.5">
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  );
}

export function Check({ size = 17, color = 'currentColor', weight = 2.5 }) {
  return (
    <svg {...stroke} width={size} height={size} stroke={color} strokeWidth={weight}>
      <path d="m20 6-11 11-5-5" />
    </svg>
  );
}

/** Badge-style sold mark for fully sold listings. */
export function SoldBadge({ size = 22, color = 'currentColor' }) {
  return (
    <svg {...stroke} width={size} height={size} stroke={color} strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.2 2.2 4.8-5.2" />
    </svg>
  );
}

export function Cross({ size = 17, color = 'currentColor', weight = 2.5 }) {
  return (
    <svg {...stroke} width={size} height={size} stroke={color} strokeWidth={weight}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function Circle({ size = 13 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="2.5">
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

export function Eye({ size = 17 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="1.9">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function EyeOff({ size = 17 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="1.9">
      <path d="M10.7 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3 4M6.5 6.6A17.7 17.7 0 0 0 2 12s3.6 7 10 7a10.7 10.7 0 0 0 4.4-.9M3 3l18 18" />
    </svg>
  );
}

export function AlertCircle({ size = 15 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="2">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  );
}

export function AlertTriangle({ size = 22, color = 'var(--bad)' }) {
  return (
    <svg {...stroke} width={size} height={size} stroke={color} strokeWidth="1.9">
      <path d="M12 2 2 20h20L12 2Z" />
      <path d="M12 9v5M12 17.5v.01" />
    </svg>
  );
}

export function ChatBubble({ size = 16 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="1.9">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 20.5l1.5-4.4A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
    </svg>
  );
}

export function Sun({ size = 16 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="1.9">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function Moon({ size = 16 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="1.9">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </svg>
  );
}

export function LogOut({ size = 16 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="1.9">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  );
}

export function Search({ size = 15, className }) {
  return (
    <svg {...stroke} className={className} width={size} height={size} stroke="var(--faint)" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

export function Refresh({ size = 15 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="2">
      <path d="M3 12a9 9 0 1 1 3 6.7" />
      <path d="M3 20v-5h5" />
    </svg>
  );
}

export function Minus({ size = 13 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="2.5">
      <path d="M5 12h14" />
    </svg>
  );
}

export function Plus({ size = 13 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="2.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ChevronLeft({ size = 16 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="2">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

export function ChevronRight({ size = 16 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="2">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function Calendar({ size = 17 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="1.9">
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function Paperclip({ size = 17 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="1.9">
      <path d="M21.4 11.1 12.3 20a5.5 5.5 0 0 1-7.8-7.8l9.1-9a3.7 3.7 0 0 1 5.2 5.2l-9.1 9a1.8 1.8 0 0 1-2.6-2.6l8.4-8.3" />
    </svg>
  );
}

export function Smiley({ size = 17 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="1.9">
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5a4 4 0 0 0 7 0M9 9.5v.01M15 9.5v.01" />
    </svg>
  );
}

/** Chevron shown on a message bubble to open its actions menu. */
export function Caret({ size = 15 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="2.2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function Send({ size = 16 }) {
  return (
    <svg {...stroke} width={size} height={size} strokeWidth="2">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}

/** The double tick on a sent message — filled in once the peer has read it. */
export function ReadTicks({ read }) {
  return (
    <svg
      {...stroke}
      width="14"
      height="14"
      stroke={read ? 'var(--accent-ink)' : 'rgba(36,24,2,.45)'}
      strokeWidth="2.4"
    >
      <path d="m2 13 4 4 8-9" />
      <path d="m11 16 1.6 1.6L21 8" />
    </svg>
  );
}

/** Torn-ticket line art used by the empty states — fixed box, never stretched. */
export function TicketArt({ withUnderline = true }) {
  const viewBox = withUnderline ? '0 0 64 56' : '0 0 64 44';

  return (
    <span className={'state__art-wrap' + (withUnderline ? '' : ' state__art-wrap--tight')} aria-hidden="true">
      <svg
        className="state__art"
        viewBox={viewBox}
        width={64}
        height={withUnderline ? 56 : 44}
        preserveAspectRatio="xMidYMid meet"
        fill="none"
        focusable="false"
      >
        {/* Ticket body ~52×32 — closer to a real stub, not a flat strip */}
        <path
          d="M10 12a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4a8 8 0 0 0 0 16a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4a8 8 0 0 0 0-16Z"
          stroke="var(--faint)"
          strokeWidth="1.75"
        />
        <path
          d="M40 8v32"
          stroke="var(--faint)"
          strokeWidth="1.75"
          strokeDasharray="3 4"
        />
        <path
          d="M16 18h18M16 26h12"
          stroke="var(--faint)"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        {withUnderline && (
          <path
            d="M26 48h12"
            stroke="var(--accent)"
            strokeWidth="2.25"
            strokeLinecap="round"
          />
        )}
      </svg>
    </span>
  );
}

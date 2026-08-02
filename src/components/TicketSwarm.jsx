/**
 * Ticket stubs drifting through 3D space on the sign-in pitch panel.
 *
 * CSS-only fallback for browsers without WebGL and for users who have asked
 * for reduced motion. Every ticket animates `transform` and `opacity` only,
 * so the work stays on the compositor with no layout or paint, and there is
 * no JavaScript running per frame.
 */

const TICKETS = [
  { brand: 'BookMyShow', screen: 'AUDI 3', seat: 'J12', path: 'a' },
  { brand: 'District', screen: 'SCREEN 1', seat: 'C04', path: 'b' },
  { brand: 'PVR', screen: 'AUDI 7', seat: 'H21', path: 'c' },
  { brand: 'INOX', screen: 'LUXE 2', seat: 'A09', path: 'd' },
  { brand: 'Cinépolis', screen: 'VIP 4', seat: 'F15', path: 'b' },
  { brand: 'Sathyam', screen: 'SCREEN 6', seat: 'G07', path: 'a' },
];

export function TicketSwarm() {
  return (
    <div className="swarm" aria-hidden="true">
      {TICKETS.map((t, i) => (
        <div
          key={t.brand}
          className={`swarm__ticket swarm__ticket--${t.path}`}
          style={{ '--i': i }}
        >
          <div className="swarm__stub">
            <span className="swarm__brand">{t.brand}</span>
            <span className="swarm__screen">{t.screen}</span>
          </div>
          <div className="swarm__rip" />
          <div className="swarm__tail">
            <span className="swarm__seat">{t.seat}</span>
            <span className="swarm__code" />
          </div>
        </div>
      ))}
    </div>
  );
}

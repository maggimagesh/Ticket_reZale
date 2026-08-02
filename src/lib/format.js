/** Up to two initials from a username, for avatar chips. */
export function initialsOf(name) {
  return (
    (name || '?')
      .replace(/[^a-zA-Z0-9]/g, ' ')
      .trim()
      .split(/\s+/)
      .map((s) => s[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

/** Rupees, grouped the Indian way: ₹1,00,000. */
export function inr(n) {
  return '₹' + Number(n || 0).toLocaleString('en-IN');
}

/** "Today" / "Tomorrow" / "Sat, 9 Aug" */
export function dayOf(iso) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(Date.now() + 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function clockOf(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function whenOf(iso) {
  return dayOf(iso) + ' · ' + clockOf(iso);
}

/** Short clock used on chat bubbles and thread previews. */
export function timeOf(ms) {
  return new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function pluralize(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

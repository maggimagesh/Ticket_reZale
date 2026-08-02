import { useEffect, useState } from 'react';

const QUERY = '(min-width: 900px)';

/**
 * True on the desktop side of the 900px breakpoint. Drives the layout
 * switches that need different markup, not just different CSS: the sign-in
 * pitch pane, the listings table vs. cards, the chat thread sidebar.
 */
export function useIsWide() {
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = (e) => setWide(e.matches);
    setWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return wide;
}

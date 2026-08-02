/**
 * One API origin for every browser deployment.
 *
 * Vercel serves the handlers at `/api`. Zoho Catalyst serves the same
 * handlers from its Advanced I/O function at `/server/tickets-api/api`.
 * Keeping this configurable at build time means callers never need to know
 * which host is serving the UI.
 */
const configuredBase = import.meta.env.VITE_API_BASE?.trim();

export const API_BASE = (configuredBase || '/api').replace(/\/+$/, '');

export const AUTH_API_BASE = `${API_BASE}/auth`;

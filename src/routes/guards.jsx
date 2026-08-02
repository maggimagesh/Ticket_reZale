import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { paths } from '../lib/paths.js';
import * as auth from '../services/authService.js';

/** Blocks app pages until a session exists. */
export function RequireAuth({ ready, user }) {
  const location = useLocation();
  if (!ready) return null;
  if (!user || !auth.loadSession()?.token) {
    return <Navigate to={paths.login} replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

/** Logged-in users hitting /login go to the marketplace. */
export function PublicOnly({ ready, user }) {
  if (!ready) return null;
  if (user && auth.loadSession()?.token) {
    return <Navigate to={paths.buy} replace />;
  }
  return <Outlet />;
}

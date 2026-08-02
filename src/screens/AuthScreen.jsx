import { useEffect, useState } from 'react';
import * as api from '../services/api.js';
import * as auth from '../services/authService.js';
import { SegmentedControl } from '../components/SegmentedControl.jsx';
import { TicketSwarm3D } from '../components/TicketSwarm3D.jsx';
import {
  AlertCircle,
  Check,
  Circle,
  Cross,
  Eye,
  EyeOff,
  Spinner,
  TicketMark,
} from '../components/icons.jsx';

const USERNAME_DEBOUNCE = 550;

/** Meter copy, colour and fill keyed by how many password rules are met. */
const STRENGTH = [
  { label: 'Too short', ink: 'var(--faint)', width: '0%' },
  { label: 'Weak', ink: 'var(--bad)', width: '25%' },
  { label: 'Fair', ink: 'var(--warn)', width: '55%' },
  { label: 'Good', ink: 'var(--warn)', width: '78%' },
  { label: 'Strong', ink: 'var(--ok)', width: '100%' },
];

export function AuthScreen({ wide, onAuthenticated }) {
  const [mode, setMode] = useState('signup');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPass, setShowPass] = useState(false);
  const [nameCheck, setNameCheck] = useState({ state: 'idle', message: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isSignup = mode === 'signup';

  /* Debounced username availability — signup only. */
  useEffect(() => {
    if (!isSignup || !username.trim()) {
      setNameCheck({ state: 'idle', message: '' });
      return undefined;
    }
    setNameCheck({ state: 'checking', message: '' });
    let live = true;
    const timer = setTimeout(async () => {
      const result = await auth.checkUsername(username);
      if (live) setNameCheck({ state: result.ok ? 'ok' : 'bad', message: result.reason });
    }, USERNAME_DEBOUNCE);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [username, isSignup]);

  const score = auth.scorePassword(password);
  const strength = STRENGTH[score];
  const confirmOk = confirm.length > 0 && confirm === password;
  const confirmBad = confirm.length > 0 && confirm !== password;

  const valid = isSignup
    ? nameCheck.state === 'ok' && score === auth.PASSWORD_RULES.length && password.length > 0 && confirmOk
    : username.trim().length > 0 && password.length > 0;

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setNameCheck({ state: 'idle', message: '' });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const call = isSignup ? auth.signup : auth.login;
      const session = await call({ username, password, remember });
      // Sign-in is the only moment the password exists, so unlock the chat
      // identity now. A failure here must not block getting into the app.
      auth.saveSession(session, remember);
      try {
        await api.setupEncryptedChat(password);
      } catch (keyErr) {
        console.error('[chat identity]', keyErr);
      }
      setPassword('');
      setConfirm('');
      await onAuthenticated(session, remember);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={'auth' + (wide ? '' : ' auth--immersive')}>
      {/* Narrow screens have no pitch pane, so the swarm becomes a full-bleed
          backdrop behind the card. Inert: it never takes pointer or focus. */}
      {!wide && (
        <div className="auth__backdrop" aria-hidden="true">
          <TicketSwarm3D />
        </div>
      )}

      {wide && (
        <div className="auth__pitch">
          <div className="brand">
            <div className="brand__mark brand__mark--lg">
              <TicketMark size={18} />
            </div>
            <span className="brand__name">Tickets reZale</span>
          </div>

          <TicketSwarm3D />

          <div style={{ maxWidth: 460 }}>
            <h1 className="auth__headline">The seat you can’t use is somebody’s Friday night.</h1>
            <p className="auth__blurb">
              A peer-to-peer marketplace for movie tickets. List what you can’t use, chat with the buyer, hand it
              over at face value.
            </p>
          </div>

        </div>
      )}

      <div className="auth__pane">
        <div className="auth__card">
          {!wide && (
            <div className="brand">
              <div className="brand__mark">
                <TicketMark size={17} perforated={false} />
              </div>
              <span className="brand__name">Tickets reZale</span>
            </div>
          )}

          <h2 className="auth__title">{isSignup ? 'Create your account' : 'Welcome back'}</h2>
          <p className="auth__subtitle">
            {isSignup
              ? 'One username, and you can buy or sell straight away.'
              : 'Log in to pick up where you left off.'}
          </p>

          <div style={{ marginBottom: 22 }}>
            <SegmentedControl
              label="Authentication mode"
              value={mode}
              onChange={switchMode}
              options={[
                { value: 'signup', label: 'Sign up' },
                { value: 'login', label: 'Log in' },
              ]}
            />
          </div>

          <form className="auth__form" onSubmit={onSubmit}>
            <div className="field">
              <label className="field__label" htmlFor="rz-user">
                Username
              </label>
              <div className="field__wrap">
                <input
                  id="rz-user"
                  className="input input--adorned-right"
                  name="username"
                  autoComplete="username"
                  placeholder="e.g. magesh_at"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setError('');
                  }}
                  aria-describedby="rz-user-help"
                />
                <div className="field__adorn">
                  {isSignup && nameCheck.state === 'checking' && <Spinner color="var(--faint)" />}
                  {isSignup && nameCheck.state === 'ok' && <Check color="var(--ok)" />}
                  {isSignup && nameCheck.state === 'bad' && <Cross color="var(--bad)" />}
                </div>
              </div>
              {isSignup && nameCheck.message && (
                <p
                  id="rz-user-help"
                  role="status"
                  className={'field__help ' + (nameCheck.state === 'ok' ? 'field__help--ok' : 'field__help--bad')}
                >
                  {nameCheck.message}
                </p>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor="rz-pass">
                Password
              </label>
              <div className="field__wrap">
                <input
                  id="rz-pass"
                  className="input input--with-toggle"
                  name="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                />
                <button
                  type="button"
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPass((v) => !v)}
                  className="pass-toggle focus-ring focus-ring--tight"
                >
                  {showPass ? <EyeOff /> : <Eye />}
                </button>
              </div>

              {isSignup && (
                <div className="pwmeter">
                  <div className="pwmeter__head">
                    <span className="pwmeter__caption">Password strength</span>
                    <span className="pwmeter__label" style={{ color: strength.ink }}>
                      {strength.label}
                    </span>
                  </div>
                  <div className="pwmeter__track">
                    <div
                      className="pwmeter__fill"
                      style={{ width: strength.width, background: strength.ink }}
                    />
                  </div>
                  <ul className="pwrules">
                    {auth.PASSWORD_RULES.map((rule) => {
                      const met = rule.test(password);
                      return (
                        <li key={rule.id} className={'pwrule' + (met ? ' pwrule--met' : '')}>
                          {met ? <Check size={13} color="var(--ok)" weight={3} /> : <Circle />}
                          <span>{rule.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            {isSignup && (
              <div className="field">
                <label className="field__label" htmlFor="rz-confirm">
                  Confirm password
                </label>
                <div className="field__wrap">
                  <input
                    id="rz-confirm"
                    className="input input--adorned-right"
                    name="confirm"
                    type={showPass ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value);
                      setError('');
                    }}
                  />
                  {confirmOk && (
                    <div className="field__adorn">
                      <Check color="var(--ok)" />
                    </div>
                  )}
                </div>
                {confirmBad && <p className="field__help field__help--bad">Passwords don’t match</p>}
              </div>
            )}

            <div className="row-between">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                Remember me
              </label>
              {!isSignup && (
                <a href="#" onClick={(e) => e.preventDefault()} style={{ fontSize: 13 }}>
                  Forgot password?
                </a>
              )}
            </div>

            {error && (
              <div className="alert-error" role="alert">
                <AlertCircle />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={!valid || busy} className="btn btn--primary btn--block focus-ring">
              {busy && <Spinner />}
              <span>{busy ? 'Just a moment…' : isSignup ? 'Create account' : 'Log in'}</span>
            </button>
          </form>

          <p className="auth__footnote">
            Accounts are stored securely in Supabase — passwords are hashed, never stored as plain text.
          </p>
        </div>
      </div>
    </div>
  );
}

import { initialsOf } from '../lib/format.js';
import { ChatBubble, LogOut, Moon, Sun, TicketMark } from './icons.jsx';

export function AppBar({ user, unreadCount = 0, chatActive, theme, onHome, onOpenChats, onToggleTheme, onLogout }) {
  return (
    <header className="appbar">
      <div className="appbar__inner">
        <button
          type="button"
          onClick={onHome}
          aria-label="Tickets reZale — back to listings"
          className="brand appbar__brand focus-ring focus-ring--tight"
        >
          <div className="brand__mark brand__mark--sm">
            <TicketMark size={16} />
          </div>
          <span className="brand__name">Tickets reZale</span>
        </button>

        <div className="appbar__actions">
          <button
            type="button"
            aria-label={
              unreadCount > 0
                ? `Open conversations, ${unreadCount} unread`
                : 'Open conversations'
            }
            onClick={onOpenChats}
            className={'iconbtn focus-ring' + (chatActive ? ' iconbtn--active' : '')}
            style={{ position: 'relative' }}
          >
            <ChatBubble />
            {unreadCount > 0 && (
              <span className="badge" aria-hidden="true">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          <button
            type="button"
            aria-label="Toggle colour theme"
            onClick={onToggleTheme}
            className="iconbtn focus-ring"
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </button>

          <div className="userchip">
            <div className="avatar avatar--accent" aria-hidden="true">
              {initialsOf(user)}
            </div>
            <span className="userchip__name truncate">{user}</span>
          </div>

          <button
            type="button"
            aria-label="Log out"
            onClick={onLogout}
            className="iconbtn iconbtn--danger focus-ring"
          >
            <LogOut />
          </button>
        </div>
      </div>
    </header>
  );
}

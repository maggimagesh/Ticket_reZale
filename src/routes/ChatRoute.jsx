import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { isThreadId, paths } from '../lib/paths.js';
import { ChatScreen } from '../screens/ChatScreen.jsx';
import * as api from '../services/api.js';
import { ApiError } from '../services/api.js';

/**
 * /chats or /chats/:threadId — thread id is an opaque UUID only (no personal data).
 * Non-participants get 403 from the API and are blocked in the UI.
 * Chat shell (left list) stays mounted; only the pane reloads.
 */
export function ChatRoute({ chat, wide, onBack, onConfirmDeal, onDenied }) {
  const { threadId } = useParams();
  const navigate = useNavigate();
  const [denied, setDenied] = useState(false);
  const verifying = useRef(null);

  useEffect(() => {
    let live = true;
    setDenied(false);

    (async () => {
      if (!threadId) {
        const pending = chat.threads.find((t) => String(t.id).startsWith('pending_'));
        if (pending) {
          await chat.openThread(pending.id);
          return;
        }
        const list = chat.threads.length ? chat.threads : await chat.refresh();
        if (!live) return;
        const first = list.find((t) => isThreadId(t.id));
        if (first) navigate(paths.chat(first.id), { replace: true });
        return;
      }

      if (!isThreadId(threadId)) {
        onDenied?.('Invalid chat link.');
        navigate(paths.chats, { replace: true });
        return;
      }

      // Switch immediately — left pane stays; chat pane shows its own loader
      verifying.current = threadId;
      void chat.openThread(threadId);

      try {
        await api.setupEncryptedChat();
        await api.getThread(threadId);
        if (!live || verifying.current !== threadId) return;
      } catch (err) {
        if (!live || verifying.current !== threadId) return;
        const msg =
          err instanceof ApiError && (err.status === 403 || err.status === 404)
            ? err.message || 'Access denied. Only the two participants in this chat can open it.'
            : err.message || 'Conversation not found.';
        onDenied?.(msg);
        setDenied(true);
        navigate(paths.buy, { replace: true });
      }
    })();

    return () => {
      live = false;
    };
    // Intentionally only when URL thread id changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  if (denied) return null;

  return (
    <ChatScreen
      chat={{
        ...chat,
        confirmDeal: onConfirmDeal,
        openThread: (id) => {
          if (isThreadId(id)) navigate(paths.chat(id));
          else chat.openThread(id);
        },
      }}
      wide={wide}
      onBack={onBack}
    />
  );
}

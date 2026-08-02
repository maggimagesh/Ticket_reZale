import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Caret,
  Check,
  ChevronLeft,
  Cross,
  Paperclip,
  ReadTicks,
  Send,
  Smiley,
} from '../components/icons.jsx';
import { initialsOf, inr, timeOf, whenOf } from '../lib/format.js';
import * as api from '../services/api.js';

const SKELETONS = [
  { align: 'flex-start', width: '58%', height: 40 },
  { align: 'flex-end', width: '44%', height: 36 },
  { align: 'flex-start', width: '50%', height: 52 },
  { align: 'flex-end', width: '38%', height: 36 },
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Matches the server's edit window in api/chat/threads/[id]/messages/[messageId].js */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Actions menu on a message bubble — edit, delete for me, delete for everyone. */
function MessageMenu({ message, mine, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onAway = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onAway);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onAway);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const sent = !message.pending && !String(message.id).startsWith('local_');
  const isText = (message.kind || 'text') === 'text';
  const withinEditWindow = Date.now() - (message.at || 0) < EDIT_WINDOW_MS;
  const canEdit = mine && sent && isText && withinEditWindow;
  const canDeleteForAll = mine && sent;

  const run = (fn) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="msgmenu" ref={wrap}>
      <button
        type="button"
        className="msgmenu__trigger focus-ring focus-ring--tight"
        aria-label="Message options"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Caret />
      </button>
      {open && (
        <div className="msgmenu__list" role="menu">
          {canEdit && (
            <button type="button" role="menuitem" onClick={run(() => onEdit(message))}>
              Edit
            </button>
          )}
          {canDeleteForAll && (
            <button
              type="button"
              role="menuitem"
              className="msgmenu__danger"
              onClick={run(() => onDelete(message, 'all'))}
            >
              Delete for everyone
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="msgmenu__danger"
            onClick={run(() => onDelete(message, 'me'))}
          >
            Delete for me
          </button>
        </div>
      )}
    </div>
  );
}

/** Full-screen viewer for a chat image. Esc or a click outside closes it. */
function ImageLightbox({ src, alt, onClose, onDownload, busy }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Stop the chat list scrolling behind the overlay
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // Rendered into <body>: `.msg` keeps a persistent transform from its `rise`
  // animation, which would otherwise make position:fixed resolve against the
  // message row instead of the viewport.
  return createPortal(
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <div className="lightbox__bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox__name">{alt}</span>
        <div className="lightbox__tools">
          {onDownload && (
            <button
              type="button"
              className="btn btn--ghost btn--xs focus-ring"
              disabled={busy}
              onClick={onDownload}
            >
              {busy ? 'Saving…' : 'Download'}
            </button>
          )}
          <button
            type="button"
            className="lightbox__close focus-ring"
            aria-label="Close image"
            onClick={onClose}
          >
            <Cross size={18} />
          </button>
        </div>
      </div>
      <img
        src={src}
        alt={alt}
        className="lightbox__pic"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  );
}

function ChatImage({ threadId, message, mine }) {
  const [src, setSrc] = useState(message.localPreview || null);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  useEffect(() => {
    if (message.localPreview || !message.hasImage || String(message.id).startsWith('local_')) {
      return undefined;
    }
    let alive = true;
    let objectUrl = null;
    (async () => {
      try {
        const blob = await api.fetchImageBlob(threadId, message.id);
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (alive) setErr(true);
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [threadId, message.id, message.hasImage, message.localPreview]);

  const onDownload = async () => {
    if (busy || String(message.id).startsWith('local_')) return;
    setBusy(true);
    try {
      await api.downloadImage(threadId, message.id, message.imageName || 'ticket-image');
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={'chatimg' + (mine ? ' chatimg--mine' : '')}>
      {err && <p className="chatimg__err">Image unavailable</p>}
      {!err && src && (
        <button
          type="button"
          className="chatimg__open focus-ring"
          aria-label={`Open ${message.imageName || 'image'} full screen`}
          onClick={() => setZoomed(true)}
        >
          <img src={src} alt={message.imageName || 'Shared image'} className="chatimg__pic" />
        </button>
      )}
      {!err && !src && <div className="chatimg__skel skeleton" />}
      {zoomed && src && (
        <ImageLightbox
          src={src}
          alt={message.imageName || 'Shared image'}
          busy={busy}
          onClose={() => setZoomed(false)}
          onDownload={String(message.id).startsWith('local_') ? null : onDownload}
        />
      )}
      <div className="chatimg__actions">
        <button
          type="button"
          className="btn btn--ghost btn--xs focus-ring"
          disabled={busy || !message.hasImage || String(message.id).startsWith('local_')}
          onClick={onDownload}
        >
          {busy ? 'Saving…' : 'Download'}
        </button>
      </div>
    </div>
  );
}

export function ChatScreen({ chat, wide, onBack }) {
  const { threads, active, loading, typing, dealDone, peerOnline } = chat;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [attachError, setAttachError] = useState('');
  const [editing, setEditing] = useState(null);
  const scroller = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);

  const messages = active?.messages || [];
  const messageCount = messages.length;
  const lastAt = messages[messageCount - 1]?.at;

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount, lastAt, typing, loading, active?.id]);

  useEffect(() => {
    if (!loading) inputRef.current?.focus();
  }, [loading, active?.id]);

  useEffect(() => {
    setAttachError('');
    setEditing(null);
    setDraft('');
  }, [active?.id]);

  const peer = active?.with ?? '';
  const peerInitials = initialsOf(peer);

  const statusLabel = typing
    ? 'typing…'
    : peerOnline
      ? 'Online'
      : 'Tap to chat';

  const isBuyer = active?.role === 'buyer';
  const isSeller = active?.role === 'seller';
  const buyerReady = !!active?.buyerConfirmed;
  const canTrade = !!active?.canTrade;
  const tradeClosed = !!active?.tradeClosed;

  const showDealButton = (() => {
    if (!active) return false;
    if (active.sold) return true;
    if (tradeClosed) return false;
    if (isBuyer) return true;
    if (isSeller) return buyerReady;
    return false;
  })();

  const dealButtonDisabled = !!(
    active?.sold ||
    (isBuyer && (active?.iConfirmed || dealDone)) ||
    (isSeller && (active?.iConfirmed || dealDone || !buyerReady)) ||
    !canTrade
  );

  const dealButtonLabel = active?.sold
    ? 'Sold'
    : isBuyer && (active?.iConfirmed || dealDone)
      ? 'Confirmed'
      : isSeller && (active?.iConfirmed || dealDone)
        ? 'Confirmed'
        : isSeller
          ? 'Confirm sale'
          : 'Confirm purchase';

  const dealNote = (() => {
    if (!active) return '';
    if (active.sold) return 'Deal done — both sides confirmed.';
    if (tradeClosed) return 'Listing removed — buy/sell is closed. Chat stays until 48h expiry.';
    if (isSeller && !buyerReady) return 'Waiting for buyer to confirm purchase…';
    if (isBuyer && (active.iConfirmed || dealDone)) return `Waiting for ${peer} to confirm sale…`;
    if (isSeller && buyerReady && !(active.iConfirmed || dealDone)) {
      return `${peer} confirmed purchase — confirm the sale.`;
    }
    if (isBuyer && active.peerConfirmed) return `${peer} confirmed — your turn.`;
    return active.listing?.seat || '';
  })();

  const startEdit = (message) => {
    setEditing({ id: message.id, original: message.text || '' });
    setDraft(message.text || '');
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
  };

  const removeMessage = async (message, scope) => {
    setAttachError('');
    try {
      if (editing?.id === message.id) cancelEdit();
      await chat.deleteMessage(message.id, scope);
    } catch (err) {
      setAttachError(err.message || 'Could not delete message');
    }
  };

  const submit = async () => {
    if (!draft.trim() || sending) return;
    const text = draft;

    if (editing) {
      // Unchanged text — just close the editor rather than round-tripping
      if (text.trim() === editing.original.trim()) {
        cancelEdit();
        return;
      }
      setSending(true);
      try {
        await chat.editMessage(editing.id, text);
        cancelEdit();
      } catch (err) {
        setAttachError(err.message || 'Could not edit message');
      } finally {
        setSending(false);
      }
      return;
    }

    setDraft('');
    setSending(true);
    try {
      await chat.send(text);
    } catch {
      setDraft(text);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || sending) return;
    setAttachError('');
    if (!String(file.type || '').startsWith('image/')) {
      setAttachError('Only image files are allowed.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAttachError('Image must be under 5 MB. Choose a smaller file.');
      return;
    }
    setSending(true);
    try {
      await chat.sendImage(file);
    } catch (err) {
      setAttachError(err.message || 'Could not upload image.');
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="chat">
      {wide && (
        <aside className="threads">
          <div className="threads__head">
            <h2>Conversations</h2>
          </div>
          <div className="threads__list">
            {threads.map((t) => {
              const msgs = t.messages || [];
              const last = msgs[msgs.length - 1];
              const unread = Number(t.unreadCount) || 0;
              const isUnread = unread > 0;
              const preview =
                last?.kind === 'image' || last?.hasImage ? 'Image' : last?.text;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => chat.openThread(t.id)}
                  aria-current={active?.id === t.id}
                  className={
                    'thread focus-ring focus-ring--inset' + (isUnread ? ' thread--unread' : '')
                  }
                >
                  <div className="avatar" aria-hidden="true">
                    {initialsOf(t.with)}
                  </div>
                  <div className="thread__body">
                    <div className="thread__top">
                      <span className="thread__who truncate">{t.with}</span>
                      <span className="thread__time">{last ? timeOf(last.at) : ''}</span>
                    </div>
                    <div className="thread__preview truncate">{preview || 'No messages yet'}</div>
                    <div className="thread__foot">
                      <span className="thread__movie truncate">{t.listing?.movie}</span>
                      {isUnread ? <span className="thread__unread">{unread > 9 ? '9+' : unread}</span> : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>
      )}

      <section className="chatpane">
        <div className="chatpane__head">
          <button
            type="button"
            className="iconbtn focus-ring"
            aria-label="Back"
            onClick={onBack}
            style={{ flex: 'none' }}
          >
            <ChevronLeft />
          </button>
          <div className="avatar chatpane__peer" aria-hidden="true">
            {peerInitials}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="chatpane__who">{peer}</div>
            <div className="chatpane__status">{statusLabel}</div>
          </div>
        </div>

        {active && (
          <div className="chat-policy" role="note">
            Chats will be deleted after 48 hours
          </div>
        )}

        {active && (
          <div className="deal">
            <div className="deal__stub">
              <div className="deal__top">
                <div style={{ minWidth: 0 }}>
                  <div className="deal__eyebrow">
                    {active.sold
                      ? 'Sold'
                      : active.tradeClosed
                        ? 'Closed'
                        : active.buyerConfirmed || active.sellerConfirmed
                          ? 'Confirming'
                          : 'Negotiating'}
                  </div>
                  <h3 className="deal__movie">{active.listing?.movie}</h3>
                  <p className="deal__line">{active.listing?.theatre}</p>
                  <p className="deal__line">{whenOf(active.listing?.showTime)}</p>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div className="deal__qty">
                    {active.qty} × {inr(active.listing?.price)}
                  </div>
                  <div className="deal__total">{inr(active.qty * (active.listing?.price || 0))}</div>
                </div>
              </div>
              <div className="deal__rule" />
              <div className="deal__foot">
                <span className="deal__note">{dealNote}</span>
                {showDealButton && (
                  <button
                    type="button"
                    onClick={chat.confirmDeal}
                    disabled={dealButtonDisabled}
                    className="btn btn--primary btn--sm btn--deal focus-ring"
                  >
                    <Check size={14} weight={2.4} />
                    {dealButtonLabel}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="messages" ref={scroller}>
          {loading &&
            SKELETONS.map((s, i) => (
              <div
                key={i}
                className="skeleton chatskel"
                style={{ alignSelf: s.align, width: s.width, height: s.height }}
              />
            ))}

          {!loading && !messages.length && active && (
            <p className="messages__empty">
              Say hi or share a ticket photo — messages and images expire after 48 hours.
            </p>
          )}

          {!loading &&
            messages.map((m) => {
              const mine = m.from === 'me';
              const gone = m.deleted === 'all';
              const isImage = !gone && (m.kind === 'image' || m.hasImage);
              return (
                <div key={m.id} className={'msg' + (mine ? ' msg--mine' : '')}>
                  {!mine && (
                    <div className="avatar" aria-hidden="true">
                      {peerInitials}
                    </div>
                  )}
                  <div className={'bubble' + (gone ? ' bubble--gone' : '')}>
                    {gone ? (
                      <div className="bubble__gone">
                        {mine ? 'You deleted this message' : 'This message was deleted'}
                      </div>
                    ) : isImage && active?.id ? (
                      <ChatImage threadId={active.id} message={m} mine={mine} />
                    ) : (
                      <div>{m.text}</div>
                    )}
                    <div className="bubble__meta">
                      <span>{m.pending ? 'Sending…' : timeOf(m.at)}</span>
                      {!gone && m.editedAt && <span className="bubble__edited">edited</span>}
                      {mine && !m.pending && <ReadTicks read={m.read} />}
                    </div>
                    {!gone && (
                      <MessageMenu
                        message={m}
                        mine={mine}
                        onEdit={startEdit}
                        onDelete={removeMessage}
                      />
                    )}
                  </div>
                </div>
              );
            })}

          {!loading && typing && (
            <div className="msg">
              <div className="avatar" aria-hidden="true">
                {peerInitials}
              </div>
              <div className="typing" role="status" aria-label={`${peer} is typing`}>
                <span />
                <span />
                <span />
              </div>
            </div>
          )}
        </div>

        <div className="composer">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif"
            hidden
            onChange={onPickImage}
          />
          {editing && (
            <div className="composer__editing" role="status">
              <span className="composer__editing-label">Editing message</span>
              <button
                type="button"
                className="btn btn--ghost btn--xs focus-ring"
                onClick={cancelEdit}
              >
                Cancel
              </button>
            </div>
          )}
          <div className="composer__bar">
            <button
              type="button"
              aria-label="Attach an image"
              disabled={sending || !!active?.pendingSellerKeys}
              onClick={() => fileRef.current?.click()}
              className="iconbtn iconbtn--plain focus-ring focus-ring--tight"
            >
              <Paperclip />
            </button>
            <button
              type="button"
              aria-label="Insert an emoji"
              onClick={(e) => e.preventDefault()}
              className="iconbtn iconbtn--plain focus-ring focus-ring--tight"
            >
              <Smiley />
            </button>
            <input
              ref={inputRef}
              className="composer__input"
              aria-label="Write a message"
              placeholder="Message…"
              value={draft}
              disabled={!!active?.pendingSellerKeys}
              onChange={(e) => {
                const next = e.target.value;
                setDraft(next);
                chat.notifyTyping?.(next);
              }}
              onBlur={() => chat.notifyTyping?.('')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                } else if (e.key === 'Escape' && editing) {
                  e.preventDefault();
                  cancelEdit();
                }
              }}
            />
            <button
              type="button"
              aria-label="Send message"
              onClick={submit}
              disabled={!draft.trim() || sending || !!active?.pendingSellerKeys}
              className="composer__send focus-ring"
            >
              <Send />
            </button>
          </div>
          {attachError ? (
            <p className="composer__hint composer__hint--bad" role="alert">
              {attachError}
            </p>
          ) : (
            <p className="composer__hint">
              {active?.pendingSellerKeys
                ? 'Waiting for the seller to enable secure messaging'
                : 'E2E encrypted · Auto-deleted after 48 hours'}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

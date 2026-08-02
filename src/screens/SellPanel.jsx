import { useEffect, useMemo, useState } from 'react';
import * as api from '../services/api.js';
import { Combobox } from '../components/Combobox.jsx';
import { DateTimePicker } from '../components/DateTimePicker.jsx';
import { QtyStepper } from '../components/QtyStepper.jsx';
import { Spinner, SoldBadge, TicketArt } from '../components/icons.jsx';
import { inr, pluralize, whenOf } from '../lib/format.js';

/** Used only when the user types a theatre that isn’t in our list. */
const FALLBACK_SEATS = ['Regular', 'Gold', 'Prime', 'Recliner'];

export const EMPTY_DRAFT = {
  movie: '',
  theatre: '',
  when: '',
  price: '',
  qty: 2,
  seat: '',
  note: '',
};

/** First unmet requirement, phrased as the next thing to do. */
function nextStep(draft, seatOptions) {
  if (!draft.movie.trim()) return 'Start with the movie name.';
  if (!draft.theatre.trim()) return 'Which theatre is it at?';
  if (!draft.when) return 'Pick the show date and time.';
  if (!(Number(draft.price) > 0)) return 'Add a price per ticket to post.';
  if (!seatOptions.length) return 'Pick a theatre to see seat types.';
  if (!draft.seat || !seatOptions.includes(draft.seat)) return 'Choose a seat type for this theatre.';
  return '';
}

export function SellPanel({ user, draft, setDraft, mine, setMine, onPosted, onDeleted, onToast }) {
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [theatres, setTheatres] = useState([]);
  const [movies, setMovies] = useState([]);
  const [moviesLoading, setMoviesLoading] = useState(false);
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const deleteListing = async (listing) => {
    if (!listing?.id || deletingId || listing.canDelete === false) return;
    const sold = Number(listing.soldQty) || 0;
    const listed = Number(listing.listedQty) || Number(listing.qty) || 0;
    const remaining = Number(listing.remainingQty) || Number(listing.qty) || 0;
    const ok = window.confirm(
      sold > 0
        ? `Remove the remaining ${remaining} ticket${remaining === 1 ? '' : 's'} from the marketplace?\n\nYou’ll still see ${sold}/${listed} sold in your history.`
        : `Remove “${listing.movie}” from the marketplace?\n\nExisting chats stay in Chats.`,
    );
    if (!ok) return;
    setDeletingId(listing.id);
    try {
      await api.deleteListing(listing.id);
      onDeleted?.(listing.id);
      if (sold > 0) {
        setMine((list) =>
          list.map((m) =>
            m.id === listing.id
              ? {
                  ...m,
                  status: 'Partial',
                  remainingQty: remaining,
                  canDelete: false,
                  fullySold: false,
                }
              : m,
          ),
        );
        onToast?.(
          'Balance removed',
          `${sold}/${listed} sold kept in your history. Remaining tickets are off the market.`,
        );
      } else {
        setMine((list) => list.filter((m) => m.id !== listing.id));
        onToast?.('Listing removed', `${listing.movie} was removed.`);
      }
    } catch (err) {
      onToast?.('Could not delete', err.message || 'Try again.');
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    let live = true;
    api
      .getTheatres()
      .then((rows) => {
        if (live) setTheatres(rows);
      })
      .catch(() => {
        if (live) setTheatres([]);
      });
    return () => {
      live = false;
    };
  }, []);

  /* Trending on mount; fuzzy remote search as the user types. */
  useEffect(() => {
    let live = true;
    const q = draft.movie.trim();
    const delay = q.length >= 2 ? 320 : 0;
    setMoviesLoading(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await api.getMovies(q.length >= 2 ? q : '');
        if (live) setMovies(rows);
      } catch {
        if (live) setMovies([]);
      } finally {
        if (live) setMoviesLoading(false);
      }
    }, delay);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [draft.movie]);

  const theatreNames = useMemo(() => theatres.map((t) => t.name), [theatres]);

  const seatOptions = useMemo(() => {
    const name = draft.theatre.trim().toLowerCase();
    if (!name) return [];
    const match = theatres.find((t) => t.name.toLowerCase() === name);
    if (match?.seatTypes?.length) return match.seatTypes;
    return FALLBACK_SEATS;
  }, [draft.theatre, theatres]);

  /* Keep seat valid whenever theatre (or its seat list) changes. */
  useEffect(() => {
    if (!seatOptions.length) {
      if (draft.seat) setDraft((d) => (d.seat ? { ...d, seat: '' } : d));
      return;
    }
    if (!seatOptions.includes(draft.seat)) {
      setDraft((d) => ({ ...d, seat: seatOptions[0] }));
    }
  }, [draft.theatre, draft.seat, seatOptions, setDraft]);

  const hint = nextStep(draft, seatOptions);
  const valid = hint === '';

  const onSubmit = async (e) => {
    e.preventDefault();
    if (!valid || posting) return;

    const payload = {
      movie: draft.movie.trim(),
      theatre: draft.theatre.trim(),
      showTime: new Date(draft.when).toISOString(),
      qty: draft.qty,
      price: Number(draft.price),
      seat: draft.seat,
      note: draft.note.trim(),
      seller: user,
    };

    const optimistic = { id: 'tmp_' + Date.now(), status: 'Live', ...payload };
    setPosting(true);
    setMine((list) => [optimistic, ...list]);

    try {
      const created = await api.postTicket(payload);
      setMine((list) => list.map((m) => (m.id === optimistic.id ? { status: 'Live', ...created } : m)));
      onPosted(created);
      setDraft({ ...EMPTY_DRAFT });
      onToast(
        'Ticket posted',
        `${payload.movie} · ${pluralize(payload.qty, 'seat')} now live on the marketplace.`,
      );
    } catch {
      setMine((list) => list.filter((m) => m.id !== optimistic.id));
      onToast('Couldn’t post', 'The listing failed to save. Try again.');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="fade-in sell">
      <section className="card">
        <h1 className="sell__title">Post a ticket</h1>
        <p className="sell__lede">Someone’s looking for exactly this seat. Takes about a minute.</p>

        <form className="sell__form" onSubmit={onSubmit}>
          <Combobox
            id="rz-movie"
            label="Movie name"
            placeholder="Enter a movie name"
            value={draft.movie}
            onChange={(movie) => set({ movie })}
            options={movies}
            filterLocal={false}
            emptyHint={
              moviesLoading
                ? 'Searching movies…'
                : 'No match — you can still type the title yourself.'
            }
          />

          <Combobox
            id="rz-theatre"
            label="Theatre name"
            placeholder="Enter a theatre name"
            value={draft.theatre}
            onChange={(theatre) => set({ theatre })}
            options={theatreNames}
            emptyHint="No match — you can still type a theatre name."
          />

          <div className="grid-2">
            <DateTimePicker
              id="rz-when"
              label="Show date & time"
              value={draft.when}
              onChange={(when) => set({ when })}
            />
            <div className="field">
              <label className="field__label" htmlFor="rz-price">
                Price per ticket
              </label>
              <div className="field__wrap">
                <span className="field__prefix" aria-hidden="true">
                  ₹
                </span>
                <input
                  id="rz-price"
                  className="input input--currency tnum"
                  type="number"
                  min="0"
                  step="10"
                  placeholder="250"
                  value={draft.price}
                  onChange={(e) => set({ price: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="grid-2">
            <div className="field">
              <span className="field__label">Tickets available</span>
              <QtyStepper
                value={draft.qty}
                onChange={(qty) => set({ qty })}
                min={1}
                max={10}
                size="box"
                decLabel="One fewer ticket"
                incLabel="One more ticket"
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="rz-seat">
                Seat type / screen
              </label>
              <select
                id="rz-seat"
                className="select"
                value={draft.seat}
                disabled={!seatOptions.length}
                onChange={(e) => set({ seat: e.target.value })}
              >
                {!seatOptions.length ? (
                  <option value="">Select a theatre first</option>
                ) : (
                  seatOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="rz-note">
              Note <span style={{ color: 'var(--faint)', fontWeight: 400 }}>— optional</span>
            </label>
            <textarea
              id="rz-note"
              className="textarea"
              rows={2}
              placeholder="Optional note for the buyer"
              value={draft.note}
              onChange={(e) => set({ note: e.target.value })}
            />
          </div>

          {hint && <p className="hint">{hint}</p>}

          <button type="submit" disabled={!valid || posting} className="btn btn--primary btn--block focus-ring">
            {posting && <Spinner />}
            <span>{posting ? 'Posting…' : 'Post Ticket'}</span>
          </button>
        </form>
      </section>

      <section>
        <div className="mine__head">
          <h2 className="mine__title">My listings</h2>
          <span className="mine__count">{pluralize(mine.length, 'listing')}</span>
        </div>

        {mine.length === 0 ? (
          <div className="state state--compact">
            <TicketArt withUnderline={false} />
            <h3 className="state__title">No tickets listed yet</h3>
            <p className="state__body">
              Be the first to sell — fill the form and your listing shows up here instantly.
            </p>
          </div>
        ) : (
          <div className="mine__list">
            {mine.map((m, i) => {
              const sold = Number(m.soldQty) || 0;
              const listed = Number(m.listedQty) || Number(m.qty) || 0;
              const remaining = Number(m.remainingQty ?? m.qty) || 0;
              const fullySold = !!m.fullySold || (sold > 0 && remaining === 0);
              const canDelete = !!m.canDelete && !fullySold;
              const statusLabel = fullySold || sold > 0 ? `${sold}/${listed} sold` : 'Live';

              return (
                <article className="minecard" key={m.id} style={{ animationDelay: `${i * 55}ms` }}>
                  <div className="minecard__head">
                    <div style={{ minWidth: 0 }}>
                      <h3 className="minecard__title">{m.movie}</h3>
                      <p className="minecard__theatre truncate">{m.theatre}</p>
                    </div>
                    <span
                      className={
                        'minecard__status' +
                        (fullySold || sold > 0 ? ' minecard__status--sold' : '')
                      }
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="minecard__meta">
                    <span>{whenOf(m.showTime)}</span>
                    <span>{inr(m.price)} each</span>
                    <span>
                      {fullySold
                        ? 'All sold'
                        : remaining > 0 && canDelete
                          ? `${remaining} left`
                          : sold > 0
                            ? 'Balance removed'
                            : `${listed} tickets`}
                    </span>
                  </div>
                  <div className="minecard__actions">
                    {fullySold ? (
                      <span className="minecard__sold" title="Fully sold" aria-label="Fully sold">
                        <SoldBadge size={20} />
                        <span>Sold</span>
                      </span>
                    ) : canDelete ? (
                      <button
                        type="button"
                        className="btn btn--danger btn--sm focus-ring"
                        disabled={deletingId === m.id}
                        onClick={() => deleteListing(m)}
                      >
                        {deletingId === m.id
                          ? 'Deleting…'
                          : sold > 0
                            ? 'Delete balance'
                            : 'Delete'}
                      </button>
                    ) : (
                      <span className="minecard__sold minecard__sold--muted" title="Off marketplace">
                        Off market
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

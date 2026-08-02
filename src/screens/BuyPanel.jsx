import { useMemo, useState } from 'react';
import { QtyStepper } from '../components/QtyStepper.jsx';
import { AlertTriangle, Refresh, Search, TicketArt } from '../components/icons.jsx';
import { clockOf, dayOf, initialsOf, inr, pluralize, whenOf } from '../lib/format.js';

const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'today', label: 'Today', match: (l) => new Date(l.showTime).toDateString() === new Date().toDateString() },
  { id: 'weekend', label: 'This weekend', match: (l) => [0, 5, 6].includes(new Date(l.showTime).getDay()) },
  { id: 'cheap', label: 'Under ₹300', match: (l) => l.price <= 300 },
];

const COLUMNS = [
  { key: 'movie', label: 'Movie', align: 'left' },
  { key: 'theatre', label: 'Theatre', align: 'left' },
  { key: 'showTime', label: 'Show time', align: 'left' },
  { key: 'seller', label: 'Seller', align: 'left' },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'qty', label: 'Available', align: 'center' },
];

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };

export function BuyPanel({ listings, load, user, wide, onRetry, onBuy, onGoSell }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState({ key: 'showTime', dir: 'asc' });
  /** listing id → how many seats the buyer has dialled up. Defaults to 1. */
  const [picks, setPicks] = useState({});

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = FILTERS.find((f) => f.id === filter)?.match ?? (() => true);
    const dir = sort.dir === 'asc' ? 1 : -1;

    return listings
      .filter((l) => l.seller !== user)
      .filter((l) => !q || `${l.movie} ${l.theatre} ${l.seller}`.toLowerCase().includes(q))
      .filter(match)
      .sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (typeof x === 'number') return (x - y) * dir;
        return String(x).localeCompare(String(y)) * dir;
      });
  }, [listings, user, query, filter, sort]);

  const pickOf = (listing) => picks[listing.id] ?? 1;
  const setPick = (listing, next) => setPicks((p) => ({ ...p, [listing.id]: next }));

  const toggleSort = (key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));

  const filtered = query.trim() !== '' || filter !== 'all';

  return (
    <div className="fade-in">
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">Available tickets</h1>
          <p className="pagehead__meta">
            {load === 'done'
              ? `${pluralize(rows.length, 'listing')} from verified sellers`
              : 'Fetching the marketplace…'}
          </p>
        </div>
        <div className="search">
          <Search className="search__icon" />
          <input
            type="search"
            className="input"
            aria-label="Search listings"
            placeholder="Search movie, theatre, seller…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="chips" role="group" aria-label="Filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className="chip focus-ring"
          >
            {f.label}
          </button>
        ))}
      </div>

      {load === 'loading' && <LoadingRows />}

      {load === 'error' && (
        <div className="state state--error" role="alert">
          <div className="state__icon">
            <AlertTriangle />
          </div>
          <h3 className="state__title">Couldn’t load listings</h3>
          <p className="state__body">The marketplace didn’t respond. Check your connection and try again.</p>
          <button type="button" onClick={onRetry} className="btn btn--ghost btn--md focus-ring">
            <Refresh />
            Retry
          </button>
        </div>
      )}

      {load === 'done' && rows.length === 0 && (
        <div className="state">
          <TicketArt />
          <h3 className="state__title">{filtered ? 'Nothing matches that' : 'No tickets listed yet'}</h3>
          <p className="state__body">
            {filtered
              ? 'Try a different filter or clear the search — new listings appear the moment someone posts.'
              : 'Be the first to sell. Your listing goes live instantly and buyers can message you right away.'}
          </p>
          <button type="button" onClick={onGoSell} className="btn btn--primary btn--md focus-ring">
            List a ticket
          </button>
        </div>
      )}

      {load === 'done' && rows.length > 0 && wide && (
        <div className="panel panel--raised">
          <table className="table">
            <thead>
              <tr>
                {COLUMNS.map((col) => {
                  const sorted = sort.key === col.key;
                  return (
                    <th key={col.key} scope="col" style={{ textAlign: col.align }}>
                      <button
                        type="button"
                        className="th-btn focus-ring focus-ring--inset"
                        data-sorted={sorted}
                        aria-label={'Sort by ' + col.label}
                        onClick={() => toggleSort(col.key)}
                        style={{ justifyContent: JUSTIFY[col.align] }}
                      >
                        <span>{col.label}</span>
                        <span className="th-btn__arrow">{sorted && sort.dir === 'desc' ? '▼' : '▲'}</span>
                      </button>
                    </th>
                  );
                })}
                <th scope="col" className="th-action">
                  Buy
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => (
                <ListingRow
                  key={l.id}
                  listing={l}
                  delay={i * 45}
                  pick={pickOf(l)}
                  onPick={(n) => setPick(l, n)}
                  onBuy={() => onBuy(l, pickOf(l))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {load === 'done' && rows.length > 0 && !wide && (
        <div className="listcards">
          {rows.map((l, i) => (
            <ListingCard
              key={l.id}
              listing={l}
              delay={i * 45}
              pick={pickOf(l)}
              onPick={(n) => setPick(l, n)}
              onBuy={() => onBuy(l, pickOf(l))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      {[0, 1, 2, 3, 4, 5].map((n) => (
        <div className="skelrow" key={n}>
          <div className="skeleton" style={{ flex: 2 }} />
          <div className="skeleton" style={{ flex: 3 }} />
          <div className="skeleton" style={{ flex: 1 }} />
          <div className="skeleton" />
        </div>
      ))}
    </div>
  );
}

function ListingRow({ listing, delay, pick, onPick, onBuy }) {
  return (
    <tr style={{ animationDelay: `${delay}ms` }}>
      <td>
        <div className="cell-movie">{listing.movie}</div>
        <div className="cell-sub">{listing.seat}</div>
      </td>
      <td className="cell-muted">{listing.theatre}</td>
      <td className="cell-nowrap">
        <div>{dayOf(listing.showTime)}</div>
        <div className="cell-sub tnum">{clockOf(listing.showTime)}</div>
      </td>
      <td>
        <div className="cell-seller">
          <div className="avatar" aria-hidden="true">
            {initialsOf(listing.seller)}
          </div>
          <span style={{ color: 'var(--muted)' }}>{listing.seller}</span>
        </div>
      </td>
      <td className="cell-price">{inr(listing.price)}</td>
      <td className="cell-center">
        <span className="qty-pill">{listing.qty} left</span>
      </td>
      <td>
        <div className="cell-actions">
          <QtyStepper value={pick} onChange={onPick} max={listing.qty} />
          <button
            type="button"
            onClick={onBuy}
            disabled={pick < 1}
            className="btn btn--primary btn--xs focus-ring"
          >
            Buy Now
          </button>
        </div>
      </td>
    </tr>
  );
}

function ListingCard({ listing, delay, pick, onPick, onBuy }) {
  return (
    <article className="listcard" style={{ animationDelay: `${delay}ms` }}>
      <div className="listcard__head">
        <div>
          <h3 className="listcard__title">{listing.movie}</h3>
          <p className="listcard__theatre">{listing.theatre}</p>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className="listcard__price">{inr(listing.price)}</div>
          <div className="listcard__unit">per ticket</div>
        </div>
      </div>

      <div className="listcard__tags">
        <span className="tag">{whenOf(listing.showTime)}</span>
        <span className="tag">{listing.seat}</span>
        <span className="tag tag--accent">{listing.qty} left</span>
      </div>

      <div className="listcard__foot">
        <div className="listcard__seller">
          <div className="avatar" aria-hidden="true">
            {initialsOf(listing.seller)}
          </div>
          <span className="truncate">{listing.seller}</span>
        </div>
        <div className="listcard__actions">
          <QtyStepper value={pick} onChange={onPick} max={listing.qty} size="lg" />
          <button
            type="button"
            onClick={onBuy}
            disabled={pick < 1}
            className="btn btn--primary btn--sm focus-ring"
          >
            Buy
          </button>
        </div>
      </div>
    </article>
  );
}

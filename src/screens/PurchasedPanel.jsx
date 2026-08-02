import { AlertTriangle, Refresh, TicketArt } from '../components/icons.jsx';
import { clockOf, dayOf, initialsOf, inr, pluralize, whenOf } from '../lib/format.js';

const COLUMNS = [
  { key: 'movie', label: 'Movie', align: 'left' },
  { key: 'theatre', label: 'Theatre', align: 'left' },
  { key: 'showTime', label: 'Show time', align: 'left' },
  { key: 'seller', label: 'Seller', align: 'left' },
  { key: 'qty', label: 'Qty', align: 'center' },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'purchasedAt', label: 'Purchased', align: 'left' },
];

const JUSTIFY = { left: 'flex-start', center: 'center', right: 'flex-end' };

export function PurchasedPanel({ purchases, load, wide, onRetry, onGoBuy }) {
  return (
    <div className="fade-in">
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">Purchased tickets</h1>
          <p className="pagehead__meta">
            {load === 'done'
              ? `${pluralize(purchases.length, 'purchase')} confirmed with sellers`
              : 'Loading your purchases…'}
          </p>
        </div>
      </div>

      {load === 'loading' && <LoadingRows />}

      {load === 'error' && (
        <div className="state state--error" role="alert">
          <div className="state__icon">
            <AlertTriangle />
          </div>
          <h3 className="state__title">Couldn’t load purchases</h3>
          <p className="state__body">Check your connection and try again.</p>
          <button type="button" onClick={onRetry} className="btn btn--ghost btn--md focus-ring">
            <Refresh />
            Retry
          </button>
        </div>
      )}

      {load === 'done' && purchases.length === 0 && (
        <div className="state">
          <TicketArt />
          <h3 className="state__title">No purchases yet</h3>
          <p className="state__body">
            When you and a seller both confirm a deal, the tickets show up here with the seller’s
            name.
          </p>
          <button type="button" onClick={onGoBuy} className="btn btn--primary btn--md focus-ring">
            Browse tickets
          </button>
        </div>
      )}

      {load === 'done' && purchases.length > 0 && wide && (
        <div className="panel panel--raised">
          <table className="table">
            <thead>
              <tr>
                {COLUMNS.map((col) => (
                  <th key={col.key} scope="col">
                    <div className="th-btn" style={{ justifyContent: JUSTIFY[col.align] }}>
                      <span>{col.label}</span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchases.map((p, i) => (
                <PurchaseRow key={p.id} purchase={p} delay={i * 45} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {load === 'done' && purchases.length > 0 && !wide && (
        <div className="listcards">
          {purchases.map((p, i) => (
            <PurchaseCard key={p.id} purchase={p} delay={i * 45} />
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      {[0, 1, 2, 3].map((n) => (
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

function PurchaseRow({ purchase, delay }) {
  return (
    <tr style={{ animationDelay: `${delay}ms` }}>
      <td>
        <div className="cell-movie">{purchase.movie}</div>
        <div className="cell-sub">{purchase.seat}</div>
      </td>
      <td className="cell-muted">{purchase.theatre}</td>
      <td className="cell-nowrap">
        <div>{dayOf(purchase.showTime)}</div>
        <div className="cell-sub tnum">{clockOf(purchase.showTime)}</div>
      </td>
      <td>
        <div className="cell-seller">
          <div className="avatar" aria-hidden="true">
            {initialsOf(purchase.seller)}
          </div>
          <span style={{ color: 'var(--muted)' }}>{purchase.seller}</span>
        </div>
      </td>
      <td className="cell-center">
        <span className="qty-pill">{purchase.qty}</span>
      </td>
      <td className="cell-price">{inr(purchase.price)}</td>
      <td className="cell-price">{inr(purchase.total)}</td>
      <td className="cell-muted cell-nowrap">{whenOf(purchase.purchasedAt)}</td>
    </tr>
  );
}

function PurchaseCard({ purchase, delay }) {
  return (
    <article className="listcard" style={{ animationDelay: `${delay}ms` }}>
      <div className="listcard__head">
        <div>
          <h3 className="listcard__title">{purchase.movie}</h3>
          <p className="listcard__theatre">{purchase.theatre}</p>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className="listcard__price">{inr(purchase.total)}</div>
          <div className="listcard__unit">
            {purchase.qty} × {inr(purchase.price)}
          </div>
        </div>
      </div>

      <div className="listcard__tags">
        <span className="tag">{whenOf(purchase.showTime)}</span>
        <span className="tag">{purchase.seat}</span>
        <span className="tag tag--accent">Purchased</span>
      </div>

      <div className="listcard__foot">
        <div className="listcard__seller">
          <div className="avatar" aria-hidden="true">
            {initialsOf(purchase.seller)}
          </div>
          <span className="truncate">{purchase.seller}</span>
        </div>
        <span className="cell-muted" style={{ fontSize: 12 }}>
          {whenOf(purchase.purchasedAt)}
        </span>
      </div>
    </article>
  );
}

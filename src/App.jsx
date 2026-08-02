import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import * as api from './services/api.js';
import * as auth from './services/authService.js';
import { AppBar } from './components/AppBar.jsx';
import { SegmentedControl } from './components/SegmentedControl.jsx';
import { Toast } from './components/Toast.jsx';
import { useChat } from './hooks/useChat.js';
import { useIsWide } from './hooks/useIsWide.js';
import { defaultTheme, saveTheme } from './lib/config.js';
import { subscribeToListings } from './lib/liveUpdates.js';
import { isThreadId, paths } from './lib/paths.js';
import { ChatRoute } from './routes/ChatRoute.jsx';
import { PublicOnly, RequireAuth } from './routes/guards.jsx';
import { AuthScreen } from './screens/AuthScreen.jsx';
import { BuyPanel } from './screens/BuyPanel.jsx';
import { PurchasedPanel } from './screens/PurchasedPanel.jsx';
import { EMPTY_DRAFT, SellPanel } from './screens/SellPanel.jsx';

const TOAST_MS = 4200;

export default function App() {
  const wide = useIsWide();
  const chat = useChat();
  const navigate = useNavigate();

  const [theme, setTheme] = useState(defaultTheme);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [listings, setListings] = useState([]);
  const [load, setLoad] = useState('loading');

  const [mine, setMine] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const [purchases, setPurchases] = useState([]);
  const [purchasesLoad, setPurchasesLoad] = useState('loading');

  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    document.body.dataset.theme = theme;
    saveTheme(theme);
  }, [theme]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const fire = useCallback((title, body) => {
    clearTimeout(toastTimer.current);
    setToast({ title, body });
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const loadListings = useCallback(async () => {
    setLoad('loading');
    try {
      const rows = await api.getListings();
      setListings(rows);
      setLoad('done');
    } catch {
      setLoad('error');
    }
  }, []);

  const loadMine = useCallback(async () => {
    try {
      const rows = await api.getMyListings();
      setMine(rows || []);
    } catch {
      setMine([]);
    }
  }, []);

  const loadPurchases = useCallback(async () => {
    setPurchasesLoad('loading');
    try {
      const rows = await api.getPurchases();
      setPurchases(rows || []);
      setPurchasesLoad('done');
    } catch {
      setPurchasesLoad('error');
    }
  }, []);

  const enterApp = useCallback(
    async (session) => {
      setUser(session.username);
      loadListings();
      loadMine();
      loadPurchases();
      await chat.seed();
    },
    [chat, loadListings, loadMine, loadPurchases],
  );

  /* Live marketplace: a listing was posted, sold, or withdrawn somewhere. */
  useEffect(() => {
    if (!user) return undefined;
    return subscribeToListings(() => {
      loadListings();
      loadMine();
    });
  }, [user, loadListings, loadMine]);

  const restoreOnce = useRef(false);
  useEffect(() => {
    if (restoreOnce.current) return;
    restoreOnce.current = true;
    (async () => {
      const saved = auth.loadSession();
      if (saved) await enterApp(saved);
      setAuthReady(true);
    })();
  }, [enterApp]);

  const onAuthenticated = async (session, remember = true) => {
    auth.saveSession(session, remember);
    await enterApp(session);
    navigate(paths.buy, { replace: true });
  };

  const logout = async () => {
    await auth.logout();
    auth.clearSession();
    chat.reset();
    setUser(null);
    setListings([]);
    setLoad('loading');
    setMine([]);
    setDraft(EMPTY_DRAFT);
    setPurchases([]);
    setPurchasesLoad('loading');
    navigate(paths.login, { replace: true });
  };

  const onBuy = async (listing, qty) => {
    try {
      const thread = await chat.startPurchase(listing, qty);
      if (thread?.id && isThreadId(thread.id)) navigate(paths.chat(thread.id));
      else navigate(paths.chats);
    } catch (err) {
      fire('Could not start chat', err.message || 'Try again.');
    }
  };

  const openChats = async () => {
    const list = await chat.refresh();
    if (!list[0]) {
      fire('No conversations yet', 'Tap Buy Now on a listing to start chatting with a seller.');
      return;
    }
    navigate(paths.chat(list[0].id));
  };

  const confirmDeal = async () => {
    try {
      const thread = await chat.confirmDeal();
      if (!thread) return;
      if (thread.sold) {
        const left = Number(thread.listingRemaining);
        if (thread.listingFullySold || (Number.isFinite(left) && left <= 0)) {
          fire('Ticket sold', 'Both of you confirmed — this listing is fully sold out.');
        } else if (Number.isFinite(left)) {
          fire(
            'Purchase complete',
            `Both confirmed. ${left} ticket${left === 1 ? '' : 's'} still available on this listing.`,
          );
        } else {
          fire('Purchase complete', 'Both of you confirmed the deal.');
        }
        loadListings();
        loadMine();
        loadPurchases();
      } else if (thread.iConfirmed) {
        fire(
          'You’re confirmed',
          `Waiting for ${thread.with} to confirm. The tickets transfer when you both confirm.`,
        );
      }
    } catch (err) {
      fire('Could not confirm', err.message || 'Try again.');
    }
  };

  const withShell = (children, { chatActive = false } = {}) => (
    <div className="shell">
      <AppBar
        user={user}
        theme={theme}
        unreadCount={chat.unreadTotal}
        chatActive={chatActive}
        onHome={() => navigate(paths.buy)}
        onOpenChats={openChats}
        onToggleTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onLogout={logout}
      />
      {children}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );

  const hasPurchases = purchasesLoad === 'done' && purchases.length > 0;

  const marketTabs = (value) => {
    const options = [
      { value: 'buy', label: 'BUY' },
      { value: 'sell', label: 'SELL' },
      ...(hasPurchases ? [{ value: 'purchased', label: 'PURCHASED' }] : []),
    ];
    return (
      <SegmentedControl
        label="Marketplace sections"
        variant="tabs"
        value={value}
        onChange={(next) => {
          if (next === 'sell') navigate(paths.sell);
          else if (next === 'purchased') {
            loadPurchases();
            navigate(paths.purchased);
          } else navigate(paths.buy);
        }}
        options={options}
      />
    );
  };

  return (
    <Routes>
      <Route element={<PublicOnly ready={authReady} user={user} />}>
        <Route
          path={paths.login}
          element={
            <>
              <AuthScreen wide={wide} onAuthenticated={onAuthenticated} />
              {toast && <Toast {...toast} onClose={() => setToast(null)} />}
            </>
          }
        />
      </Route>

      <Route element={<RequireAuth ready={authReady} user={user} />}>
        <Route
          path={paths.buy}
          element={withShell(
            <main className="main">
              {marketTabs('buy')}
              <BuyPanel
                listings={listings}
                load={load}
                user={user}
                wide={wide}
                onRetry={loadListings}
                onBuy={onBuy}
                onGoSell={() => navigate(paths.sell)}
              />
            </main>,
          )}
        />

        <Route
          path={paths.sell}
          element={withShell(
            <main className="main">
              {marketTabs('sell')}
                <SellPanel
                  user={user}
                  draft={draft}
                  setDraft={setDraft}
                  mine={mine}
                  setMine={setMine}
                  onPosted={(created) => {
                    setListings((rows) => [created, ...rows]);
                    setMine((rows) => {
                      const next = {
                        ...created,
                        soldQty: 0,
                        listedQty: Number(created.qty) || 1,
                        remainingQty: Number(created.qty) || 1,
                        fullySold: false,
                        canDelete: true,
                        status: 'live',
                      };
                      return rows.some((r) => r.id === created.id)
                        ? rows.map((r) => (r.id === created.id ? next : r))
                        : [next, ...rows];
                    });
                  }}
                  onDeleted={(id) => {
                    setListings((rows) => rows.filter((r) => r.id !== id));
                  }}
                  onToast={fire}
                />
            </main>,
          )}
        />

        <Route
          path={paths.purchased}
          element={
            hasPurchases || purchasesLoad === 'loading' ? (
              withShell(
                <main className="main">
                  {marketTabs('purchased')}
                  <PurchasedPanel
                    purchases={purchases}
                    load={purchasesLoad}
                    wide={wide}
                    onRetry={loadPurchases}
                    onGoBuy={() => navigate(paths.buy)}
                  />
                </main>,
              )
            ) : (
              <Navigate to={paths.buy} replace />
            )
          }
        />

        <Route
          path={paths.chats}
          element={withShell(
            <ChatRoute
              chat={chat}
              wide={wide}
              onBack={() => navigate(paths.buy)}
              onConfirmDeal={confirmDeal}
              onDenied={(msg) => fire('Access denied', msg)}
            />,
            { chatActive: true },
          )}
        />

        <Route
          path={`${paths.chats}/:threadId`}
          element={withShell(
            <ChatRoute
              chat={chat}
              wide={wide}
              onBack={() => navigate(paths.buy)}
              onConfirmDeal={confirmDeal}
              onDenied={(msg) => fire('Access denied', msg)}
            />,
            { chatActive: true },
          )}
        />
      </Route>

      <Route path="/" element={<Navigate to={user ? paths.buy : paths.login} replace />} />
      <Route path="*" element={<Navigate to={user ? paths.buy : paths.login} replace />} />
    </Routes>
  );
}

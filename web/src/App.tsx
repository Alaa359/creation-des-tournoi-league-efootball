import { useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'motion/react';
import { api, type TournamentSummary } from './shared/api';
import { AuthProvider, useAuth } from './shared/AuthContext';
import { Card, FadeIn, Spinner, TypeBadge } from './ui/primitives';
import { BallLoader, BackgroundSlideshow } from './ui/fx';
import { CreatePage } from './features/create/CreatePage';
import { AdminPage } from './features/admin/AdminPage';
import { AdminDashboard } from './features/admin/AdminDashboard';
import { ViewerPage } from './features/view/ViewerPage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';

function daysRemaining(expiresAt?: string): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function ExpiryBadge({ expiresAt }: { expiresAt?: string }) {
  const days = daysRemaining(expiresAt);
  if (days === null) return null;
  if (days === 0) return <span className="text-xs font-bold text-red-400">Expire aujourd'hui</span>;
  if (days <= 3) return <span className="text-xs font-bold text-amber-400">⏱ {days}j restant{days > 1 ? 's' : ''}</span>;
  if (days <= 7) return <span className="text-xs text-amber-300/70">{days}j</span>;
  return null;
}

function Header() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const logout = async () => {
    await api.logout();
    await refresh();
    navigate('/');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b0f19]/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <motion.span
            className="text-2xl"
            animate={{ rotate: 360 }}
            transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          >
            ⚽
          </motion.span>
          <span className="font-display text-2xl tracking-wider text-white">
            EFOOTBALL <span className="text-lime-400">CUP</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm font-semibold">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition ${isActive ? 'bg-lime-400/15 text-lime-300' : 'text-slate-300 hover:bg-white/5'}`
            }
          >
            <img
              src="/logos/home-icon.svg"
              alt=""
              aria-hidden
              className="h-4 w-4 drop-shadow-[0_1px_4px_rgba(163,230,53,0.4)]"
            />
            Accueil
          </NavLink>
          {user ? (
            <>
              <NavLink
                to="/create"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${isActive ? 'bg-lime-400/15 text-lime-300' : 'text-slate-300 hover:bg-white/5'}`
                }
              >
                Créer
              </NavLink>
              {user.role === 'admin' && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-1.5 transition ${isActive ? 'bg-amber-400/15 text-amber-300' : 'text-slate-300 hover:bg-white/5'}`
                  }
                >
                  Admin
                </NavLink>
              )}
              <button
                type="button"
                onClick={logout}
                className="rounded-lg px-3 py-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
              >
                Déconnexion
              </button>
            </>
          ) : (
            <>
              <NavLink
                to="/login"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 transition ${isActive ? 'bg-lime-400/15 text-lime-300' : 'text-slate-300 hover:bg-white/5'}`
                }
              >
                Connexion
              </NavLink>
              <NavLink
                to="/register"
                className="btn-primary !px-3 !py-1.5 !text-sm"
              >
                Inscription
              </NavLink>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function HomePage() {
  const [items, setItems] = useState<TournamentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    api
      .listTournaments()
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <FadeIn className="mb-10 text-center">
        <h1 className="font-display text-5xl tracking-wide sm:text-7xl">
          ORGANISEZ VOS <span className="bg-gradient-to-r from-lime-300 to-emerald-400 bg-clip-text text-transparent">TOURNOIS EFOOTBALL</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl font-display text-2xl tracking-wide text-lime-200">
          Bienvenue sur le site Championnat Rafraf eFootball
        </p>
        <div className="mt-6 flex justify-center gap-3">
          {user ? (
            <Link to="/create" className="btn-primary text-lg">
              <img
                src="/logos/trophy-cup.svg"
                alt=""
                aria-hidden
                className="h-7 w-auto drop-shadow-[0_2px_6px_rgba(6,78,59,0.4)]"
              />
              Créer un tournoi
            </Link>
          ) : (
            <Link to="/register" className="btn-primary text-lg">
              S'inscrire pour créer
            </Link>
          )}
        </div>
        {user && !user.approved && (
          <p className="mt-3 text-sm text-amber-300">
            Votre compte est en attente d'approbation par l'administrateur.
          </p>
        )}
      </FadeIn>

      <section>
        <h2 className="font-display mb-4 text-2xl tracking-wide text-slate-300">
          Derniers tournois
        </h2>
        {error && <Card className="p-6 text-red-300">{error}</Card>}
        {!error && items === null && (
          <div className="py-14">
            <BallLoader />
          </div>
        )}
        {items !== null && items.length === 0 && (
          <Card className="p-8 text-center text-slate-400">
            Aucun tournoi pour l'instant. Lancez le premier coup d'envoi !
          </Card>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(items ?? []).map((t, i) => (
            <FadeIn key={t.id} delay={i * 0.05}>
              <Link to={`/t/${t.id}`}>
                <Card className="group h-full p-5 transition hover:border-lime-400/40 hover:bg-white/[0.08]">
                  <div className="flex items-center justify-between gap-2">
                    <TypeBadge type={t.type} />
                    <span className="text-xs text-slate-500">
                      {new Date(t.createdAt).toLocaleDateString('fr-FR')}
                    </span>
                  </div>
                  <h3 className="font-display mt-3 truncate text-2xl tracking-wide group-hover:text-lime-300">
                    {t.name}
                  </h3>
                  <p className="mt-1 text-sm text-slate-400">
                    👥 {t.playerCount} joueur{t.playerCount > 1 ? 's' : ''}
                  </p>
                  <ExpiryBadge expiresAt={t.expiresAt} />
                </Card>
              </Link>
            </FadeIn>
          ))}
        </div>
      </section>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="font-display text-6xl text-lime-300">404</p>
      <p className="mt-3 text-slate-400">Ce terrain n'existe pas.</p>
      <Link to="/" className="btn-primary mt-6">
        Retour au stade
      </Link>
    </div>
  );
}

function RequireAuth({ children, adminOnly = false }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="py-24 text-center"><Spinner /></div>;
  if (!user) return <div className="mx-auto max-w-md px-4 py-24 text-center"><Card className="p-8 text-center"><p className="text-slate-300 font-bold">Connexion requise</p><Link to="/login" className="btn-primary mt-4 inline-flex">Se connecter</Link></Card></div>;
  if (adminOnly && user.role !== 'admin') return <div className="mx-auto max-w-md px-4 py-24 text-center"><Card className="p-8 text-center text-red-300">Accès administrateur requis</Card></div>;
  return <>{children}</>;
}

export default function App() {
  const location = useLocation();
  return (
    <AuthProvider>
      <div className="flex min-h-screen flex-col">
        <BackgroundSlideshow />
        <Header />
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="flex-1"
          >
            <Routes location={location}>
              <Route path="/" element={<HomePage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route
                path="/create"
                element={<RequireAuth><CreatePage /></RequireAuth>}
              />
              <Route
                path="/admin"
                element={<RequireAuth adminOnly><AdminDashboard /></RequireAuth>}
              />
              <Route path="/t/:id" element={<ViewerPage />} />
              <Route
                path="/t/:id/admin"
                element={<RequireAuth><AdminPage /></RequireAuth>}
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </motion.main>
        </AnimatePresence>
        <footer className="border-t border-white/5 py-6 text-center text-xs text-slate-600">
          eFootball Cup · fait pour jouer entre amis
        </footer>
      </div>
    </AuthProvider>
  );
}

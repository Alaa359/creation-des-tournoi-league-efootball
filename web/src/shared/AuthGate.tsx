import { useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

/**
 * Porte d'entrée organisateur : vérifie la session admin,
 * demande le mot de passe le cas échéant, puis rend les enfants.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'locked' | 'open'>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = () =>
      api
        .me()
        .then(({ admin }) => setStatus(admin ? 'open' : 'locked'))
        .catch(() => setStatus('locked'));
    check();
    const interval = setInterval(check, 15_000);
    return () => clearInterval(interval);
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex justify-center py-24">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-lime-400/30 border-t-lime-400" />
      </div>
    );
  }

  if (status === 'open') return <>{children}</>;

  return (
    <div className="mx-auto mt-16 max-w-md">
      <form
        className="card space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          api
            .login(password)
            .then(() => setStatus('open'))
            .catch((err: Error) => setError(err.message))
            .finally(() => setBusy(false));
        }}
      >
        <div>
          <h2 className="font-display text-3xl tracking-wide text-lime-300">Espace organisateur</h2>
          <p className="mt-1 text-sm text-slate-400">
            Saisie des scores réservée à l'organisateur du tournoi.
          </p>
        </div>
        <input
          type="password"
          className="input"
          placeholder="Mot de passe organisateur"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <p className="text-sm font-semibold text-red-400">{error}</p>}
        <button type="submit" className="btn-primary w-full" disabled={busy || !password}>
          {busy ? 'Connexion…' : 'Déverrouiller'}
        </button>
      </form>
    </div>
  );
}

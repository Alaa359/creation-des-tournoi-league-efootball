import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/AuthContext';
import { Card, FadeIn, Spinner } from '../../ui/primitives';

export function LoginPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login({ email, password });
      await refresh();
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <FadeIn>
        <h1 className="font-display text-4xl tracking-wide text-center">CONNEXION</h1>
        <p className="mt-1 text-center text-slate-400">Accédez à votre espace.</p>
      </FadeIn>

      <FadeIn delay={0.08}>
        <Card className="mt-6 p-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-sm font-bold text-slate-300">Email</label>
              <input
                className="input"
                type="email"
                placeholder="votre@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-bold text-slate-300">Mot de passe</label>
              <input
                className="input"
                type="password"
                placeholder="••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm font-semibold text-red-400">{error}</p>}
            <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
              {busy ? <Spinner className="h-5 w-5" /> : 'Se connecter'}
            </button>
          </form>
          <p className="mt-4 text-center text-sm text-slate-400">
            Pas encore de compte ?{' '}
            <Link to="/register" className="font-semibold text-lime-300 hover:underline">
              S'inscrire
            </Link>
          </p>
        </Card>
      </FadeIn>
    </div>
  );
}

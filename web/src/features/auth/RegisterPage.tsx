import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../shared/api';
import { Card, FadeIn, Spinner } from '../../ui/primitives';

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email || !password) return;
    setBusy(true);
    setError(null);
    try {
      await api.register({ name: name.trim(), email, password });
      setSuccess("Compte créé ! En attente d'approbation par l'administrateur.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur d'inscription");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <FadeIn>
        <h1 className="font-display text-4xl tracking-wide text-center">INSCRIPTION</h1>
        <p className="mt-1 text-center text-slate-400">Créez votre compte pour participer.</p>
      </FadeIn>

      <FadeIn delay={0.08}>
        <Card className="mt-6 p-6">
          {success ? (
            <div className="space-y-4 text-center">
              <p className="text-lime-300 font-semibold">{success}</p>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="btn-primary w-full text-lg"
              >
                Se connecter
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-bold text-slate-300">Nom</label>
                <input
                  className="input"
                  placeholder="Votre nom"
                  value={name}
                  maxLength={30}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
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
                  placeholder="Minimum 6 caractères"
                  value={password}
                  minLength={6}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && <p className="text-sm font-semibold text-red-400">{error}</p>}
              <button type="submit" className="btn-primary w-full text-lg" disabled={busy}>
                {busy ? <Spinner className="h-5 w-5" /> : "🚀 S'inscrire"}
              </button>
            </form>
          )}
          <p className="mt-4 text-center text-sm text-slate-400">
            Déjà un compte ?{' '}
            <Link to="/login" className="font-semibold text-lime-300 hover:underline">
              Se connecter
            </Link>
          </p>
        </Card>
      </FadeIn>

      <FadeIn delay={0.15}>
        <p className="mt-4 text-center text-xs text-slate-500">
          Le premier compte inscrit devient l'administrateur.
        </p>
      </FadeIn>
    </div>
  );
}

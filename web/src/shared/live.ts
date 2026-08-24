import { useEffect, useState } from 'react';
import { api, type Tournament } from './api';

/**
 * Charge un tournoi puis le maintient à jour par rafraîchissement périodique
 * (compatible hébergement serverless type Netlify, sans connexion persistante).
 * Le polling se met en pause quand l'onglet est masqué et rafraîchit au retour.
 */
export function useLiveTournament(id: string | undefined) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!id) return;
    let disposed = false;
    let inFlight = false;

    const load = (): void => {
      if (inFlight) return;
      inFlight = true;
      api
        .getTournament(id)
        .then((t) => {
          if (!disposed) {
            setTournament(t);
            setError(null);
            setLive(true);
          }
        })
        .catch((e: Error) => {
          if (!disposed) {
            setError(e.message);
            setLive(false);
          }
        })
        .finally(() => {
          inFlight = false;
        });
    };

    load();

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 4000);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [id]);

  return { tournament, setTournament, error, live };
}

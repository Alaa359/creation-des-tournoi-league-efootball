import { useEffect, useState } from 'react';
import { api, type Tournament } from './api';

/**
 * Charge un tournoi puis le maintient à jour via le flux SSE.
 * Toute mutation côté organisateur déclenche un refetch automatique chez tous les spectateurs.
 */
export function useLiveTournament(id: string | undefined) {
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!id) return;
    let disposed = false;

    const load = (): void => {
      api
        .getTournament(id)
        .then((t) => {
          if (!disposed) {
            setTournament(t);
            setError(null);
          }
        })
        .catch((e: Error) => {
          if (!disposed) setError(e.message);
        });
    };

    load();

    const es = new EventSource(`/api/events/${id}`);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener('update', load);

    return () => {
      disposed = true;
      es.close();
    };
  }, [id]);

  return { tournament, setTournament, error, live };
}

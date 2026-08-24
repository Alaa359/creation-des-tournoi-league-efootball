import type { Match, Tournament } from './api';

/** Un match est-il une confrontation à élimination directe ? */
export function isKnockoutMatch(t: Tournament, m: Match): boolean {
  if (m.phase) return m.phase === 'knockout';
  return t.type === 'knockout';
}

export function knockoutMatches(t: Tournament): Match[] {
  return t.matches.filter((m) => isKnockoutMatch(t, m));
}

export function roundRobinMatches(t: Tournament): Match[] {
  return t.matches.filter((m) => !isKnockoutMatch(t, m));
}

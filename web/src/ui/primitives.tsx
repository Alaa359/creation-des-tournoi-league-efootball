import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';

export function Spinner({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-lime-400/30 border-t-lime-400 ${className}`}
      role="status"
      aria-label="Chargement"
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

const TYPE_STYLES: Record<string, { label: string; cls: string; logos: string[] }> = {
  league: { label: 'League', cls: 'bg-sky-400/15 text-sky-300', logos: ['/logos/league.svg'] },
  knockout: { label: 'Knockout', cls: 'bg-fuchsia-400/15 text-fuchsia-300', logos: ['/logos/knockout.svg'] },
  'league-knockout': {
    label: 'League + KO',
    cls: 'bg-violet-400/15 text-violet-300',
    logos: ['/logos/league.svg', '/logos/knockout.svg'],
  },
  'groups-knockout': {
    label: 'Groupes + KO',
    cls: 'bg-amber-400/15 text-amber-300',
    logos: ['/logos/group.png', '/logos/knockout.svg'],
  },
  playoff: {
    label: 'Playoff',
    cls: 'bg-emerald-400/15 text-emerald-300',
    logos: ['/logos/group.png', '/logos/league.svg'],
  },
};

export function TypeBadge({ type }: { type: string }) {
  const s = TYPE_STYLES[type] ?? TYPE_STYLES.knockout;
  return (
    <span className={`badge ${s.cls}`}>
      {s.logos.map((src) => (
        <img key={src} src={src} alt="" className="h-4 w-8 object-contain drop-shadow" />
      ))}
      {s.label}
    </span>
  );
}

const AVATAR_HUES = [
  'text-lime-300',
  'text-sky-300',
  'text-amber-300',
  'text-fuchsia-300',
  'text-emerald-300',
  'text-rose-300',
];

/** Maillot de football au rendu 3D (ombrage, reflet, plis) — sans symbole. */
export function JerseyIcon({ className = '' }: { className?: string }) {
  const uid = useId();
  const glowId = `${uid}-glow`;
  const shadeId = `${uid}-shade`;
  const tee =
    'M7.2 2.3 12 4.9l4.8-2.6 4 2.5a1.1 1.1 0 0 1 .38 1.44l-2.05 4a1.1 1.1 0 0 1-1.42.5l-1.31-.62V20a1.6 1.6 0 0 1-1.6 1.6H9.2A1.6 1.6 0 0 1 7.6 20V9.72l-1.31.62a1.1 1.1 0 0 1-1.42-.5l-2.05-4A1.1 1.1 0 0 1 3.2 4.8z';
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <defs>
        <radialGradient id={glowId} cx="0.32" cy="0.18" r="1.05">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.7" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.12" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={shadeId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000000" stopOpacity="0.5" />
          <stop offset="0.3" stopColor="#000000" stopOpacity="0" />
          <stop offset="0.72" stopColor="#000000" stopOpacity="0" />
          <stop offset="1" stopColor="#000000" stopOpacity="0.42" />
        </linearGradient>
      </defs>
      <path d={tee} fill="currentColor" />
      <path d={tee} fill={`url(#${glowId})`} />
      <path d={tee} fill={`url(#${shadeId})`} />
      <g fill="none" stroke="#000000" strokeOpacity="0.28" strokeWidth="0.65" strokeLinecap="round">
        <path d="M9.9 4.7 Q12 6.7 14.1 4.7" />
        <path d="M8.7 19.4 Q12 20.5 15.3 19.4" />
        <path d="M5.3 6.2 Q6.6 8.2 8 8.9" />
        <path d="M18.7 6.2 Q17.4 8.2 16 8.9" />
        <path d="M10.4 12 Q12 12.7 13.6 12" strokeOpacity="0.14" />
      </g>
    </svg>
  );
}

/** Logo joueur : maillot 3D coloré (hash du pseudo), sans symbole imprimé dessus. */
export function PlayerAvatar({ name }: { name: string }) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length];
  return (
    <span
      className={`relative flex h-7 w-7 shrink-0 items-center justify-center ${hue}`}
      title={name}
    >
      <JerseyIcon className="h-full w-full drop-shadow-[0_2px_3px_rgba(0,0,0,0.55)]" />
    </span>
  );
}

/** Libellé professionnel d'un tour de bracket (miroir de la logique serveur). */
export function getRoundLabel(round: number, totalRounds: number): string {
  switch (totalRounds - round) {
    case 0:
      return 'Finale';
    case 1:
      return 'Demi-finales';
    case 2:
      return 'Quarts de finale';
    case 3:
      return 'Huitièmes de finale';
    case 4:
      return 'Seizièmes de finale';
    case 5:
      return 'Trente-deuxièmes de finale';
    default:
      return `Tour ${round}`;
  }
}

export function FadeIn({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

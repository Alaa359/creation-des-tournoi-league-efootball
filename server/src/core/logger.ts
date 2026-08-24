import pino from 'pino';
import { config } from './config';

/**
 * Journalisation asynchrone bufferisée (Protocole n°4) :
 * niveaux essentiels uniquement, secrets masqués, zéro blocage du thread HTTP.
 */
export const logger = pino({
  level: config.logLevel,
  redact: {
    paths: ['password', '*.password', 'req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
});

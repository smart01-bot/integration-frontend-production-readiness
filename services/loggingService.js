import winston from 'winston';
import morgan from 'morgan';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console()
  ],
});

/**
 * Morgan stream adapter (audit gap 22).
 *
 * Morgan writes HTTP access logs through winston so requests land in the
 * same structured logs as everything else (logs/combined.log + console),
 * instead of vanishing into stdout-only noise.
 *
 * `httpStream` for use as morgan's `{ stream: httpStream }` option.
 * Status >= 400 goes to warn, server errors (>= 500) to error — so the
 * error log captures failing endpoints without any extra wiring.
 */
const httpStream = {
  write: (message) => {
    // morgan's line ends with \n and carries status as a token we parse out
    // of the compiled format; we use a custom format string in index.js that
    // puts status first, so this stays cheap and dependency-free.
    const trimmed = message.trim();
    const status = parseInt(trimmed.split(' ')[0], 10);
    if (Number.isFinite(status) && status >= 500) {
      logger.error(`http ${trimmed}`);
    } else if (Number.isFinite(status) && status >= 400) {
      logger.warn(`http ${trimmed}`);
    } else {
      logger.info(`http ${trimmed}`);
    }
  },
};

// Pre-built morgan middleware with the status-first format httpStream parses.
// Skip noisy paths: health checks and CORS preflights would flood the log.
const morganMiddleware = morgan(
  ':status :method :url :res[content-length] - :response-time ms - :remote-addr',
  {
    stream: httpStream,
    skip: (req) =>
      req.path === '/api/v1/health' ||
      req.path === '/' ||
      req.method === 'OPTIONS',
  }
);

export { logger, morganMiddleware, httpStream };

import express from 'express';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import cors from 'cors';
import helmet from 'helmet';
import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';

// Import Tour de Rotary DSM Route Modules
import activityRoutes from './routes/activityRoutes.js';
import cartRoutes from './routes/cartRoutes.js';
import merchandiseRoutes from './routes/merchandiseRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import participantRoutes from './routes/participantRoutes.js';
import socialRoutes from './routes/socialRoutes.js';
import communicationRoutes from './routes/communicationRoutes.js';
import campaignRoutes from './routes/campaignRoutes.js';
import evaluationRoutes from './routes/evaluationRoutes.js';
import volunteerRoutes from './routes/volunteerRoutes.js';
import sponsorRoutes from './routes/sponsorRoutes.js';
import partnerRoutes from './routes/partnerRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import collectibleRoutes from './routes/collectibleRoutes.js';
import fitnessRoutes from './routes/fitnessRoutes.js';
import newsletterRoutes from './routes/newsletterRoutes.js';
import commsRoutes from './routes/commsRoutes.js';
import contentRoutes from './routes/contentRoutes.js';

// Tour de Dar — Triathlon & Community Routes
import triathlonRoutes from './routes/triathlonRoutes.js';
import communityRoutes from './routes/communityRoutes.js';
import teamRoutes from './routes/teamRoutes.js';
import challengeRoutes from './routes/challengeRoutes.js';
import resultsRoutes from './routes/resultsRoutes.js';
import storiesRoutes from './routes/storiesRoutes.js';
import consentRoutes from './routes/consentRoutes.js';
import bibRoutes from './routes/bibRoutes.js';
import photoRoutes from './routes/photoRoutes.js';
import researchRoutes from './routes/researchRoutes.js';

// Middleware & Workers
import errorHandler from './middleware/errorHandler.js';
import { runInventoryReservationWorker } from './services/inventoryReservationWorker.js';
import { runCommunicationDispatchWorker } from './services/communicationDispatchWorker.js';
import { runPhaseEngine } from './services/phaseEngineService.js';
import { logger, morganMiddleware } from './services/loggingService.js';
import { supabase } from './config/supabase.js';

const app = express();

// Request logging — every request flows through winston (audit gap 22),
// with >=400 as warn and >=500 as error in logs/error.log.
app.use(morganMiddleware);

// Security and middleware
app.use(helmet());

// NOTE: origin '*' combined with credentials:true is invalid per the CORS
// spec and browsers will reject it, silently breaking cookie-based auth.
// Configure ALLOWED_ORIGINS as a comma-separated list in .env for
// production (e.g. "https://tourderotary.co.tz,https://admin.tourderotary.co.tz").
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // x-user-role is accepted for backward compatibility with existing
  // clients but is no longer trusted for authorization decisions — see
  // middleware/rbac.js, which resolves role only from the verified
  // req.user set by middleware/auth.js.
  allowedHeaders: ['Content-Type', 'Authorization', 'x-payme-signature', 'x-user-role']
}));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());

// Root & Health Check Endpoints
app.get('/', (req, res) => {
  res.json({
    service: 'Tour de Rotary DSM 2026 - Production Backend API',
    status: 'ONLINE',
    version: '1.0.0',
    documentation: '/api/v1/health',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/v1/health', async (req, res) => {
  const isConfigured = (val) => Boolean(val) && !val.includes('your_') && !val.startsWith('demo_');

  // Audit gap 21: the health check used to report a static 'healthy' without
  // ever touching the database — monitoring stayed green while Supabase was
  // down. Ping it for real. Head request to a known table is the cheapest
  // possible probe and exercises auth + REST + Postgres in one round trip.
  const healthStart = Date.now();
  let dbStatus = 'up';
  let dbLatencyMs = null;
  try {
    const { error } = await supabase
      .from('event_config')
      .select('id', { count: 'exact', head: true });
    if (error) throw error;
    dbLatencyMs = Date.now() - healthStart;
  } catch (err) {
    dbStatus = 'down';
    dbLatencyMs = Date.now() - healthStart;
    logger.error(`health: database probe FAILED (${err.message || err})`);
  }

  const overall = dbStatus === 'up' ? 'healthy' : 'degraded';

  res.status(dbStatus === 'up' ? 200 : 503).json({
    status: overall,
    checks: {
      database: { status: dbStatus, latency_ms: dbLatencyMs }
    },
    environment: process.env.NODE_ENV || 'development',
    database: 'Supabase PostgreSQL 16',
    edition: 'Tour de Rotary DSM 2026',
    integrations: {
      payme_africa: isConfigured(process.env.PAYME_API_KEY) ? 'READY' : 'NOT_CONFIGURED',
      textify_sms: isConfigured(process.env.TEXTIFY_API_KEY) ? 'READY' : 'NOT_CONFIGURED',
      resend_email: isConfigured(process.env.RESEND_API_KEY) ? 'READY' : 'NOT_CONFIGURED',
      strava_sync: isConfigured(process.env.STRAVA_CLIENT_ID) ? 'READY' : 'NOT_CONFIGURED',
      polygon_certificates: isConfigured(process.env.POLYGON_RPC_URL) ? 'READY' : 'NOT_CONFIGURED'
    },
    timestamp: new Date().toISOString()
  });
});

// API Routes Mounting (v1)
app.use('/api/v1/activities', activityRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/merchandise', merchandiseRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/participant', participantRoutes);
app.use('/api/v1/social', socialRoutes);
app.use('/api/v1/communications', communicationRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/evaluation', evaluationRoutes);
app.use('/api/v1/volunteer', volunteerRoutes);
app.use('/api/v1/sponsor', sponsorRoutes);
app.use('/api/v1/partner', partnerRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/collectibles', collectibleRoutes);
app.use('/api/v1/fitness', fitnessRoutes);
app.use('/api/v1/newsletter', newsletterRoutes);
app.use('/api/v1/comms', commsRoutes);
app.use('/api/v1/content', contentRoutes);

// Tour de Dar — Triathlon & Community
app.use('/api/v1/triathlon', triathlonRoutes);
app.use('/api/v1/community', communityRoutes);
app.use('/api/v1/teams', teamRoutes);
app.use('/api/v1/challenges', challengeRoutes);
app.use('/api/v1/results', resultsRoutes);
app.use('/api/v1/stories', storiesRoutes);
app.use('/api/v1/bibs', bibRoutes);
app.use('/api/v1/photos', photoRoutes);
app.use('/api/v1/consent', consentRoutes);
app.use('/api/v1/research', researchRoutes);

// Background workers — all intervals registered so graceful shutdown can
// stop them (audit gap 22). Un-drained worker cycles were previously killed
// mid-job on every deploy/restart.
const workerIntervals = [];

// Background Worker: 7-Day Merchandise Reservation & Expiry Auto-Release Engine
// Runs every 10 minutes in dev / 1 hour in prod
workerIntervals.push(setInterval(async () => {
  try {
    await runInventoryReservationWorker();
  } catch (err) {
    logger.error('Inventory worker cycle error:', err);
  }
}, 10 * 60 * 1000));

// Background Worker: Communication Queue Dispatcher
// Drains due SMS/Email items from communication_queue (scheduled reminders,
// broadcasts, confirmations). Runs frequently since messages are often
// time-sensitive (e.g. event-day briefings).
workerIntervals.push(setInterval(async () => {
  try {
    await runCommunicationDispatchWorker();
  } catch (err) {
    logger.error('Communication dispatch worker cycle error:', err);
  }
}, 60 * 1000));

// Background Worker: Phase Engine (proposal §03 phase-aware behaviour)
// Derives pre_event / event_day / post_event from the scheduled event_date
// and persists transitions, so the platform switches experience automatically.
workerIntervals.push(setInterval(async () => {
  try {
    await runPhaseEngine();
  } catch (err) {
    logger.error('Phase engine cycle error:', err);
  }
}, 60 * 1000));

// Global Error Handler
app.use(errorHandler);

const PORT = parseInt(String(process.env.PORT || '8800').trim(), 10) || 8800;
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`Backend API running on port ${PORT} — health at /api/v1/health`);
  console.log(`=======================================================`);
  console.log(`🚲 TOUR DE ROTARY DSM 2026 BACKEND API RUNNING ON PORT ${PORT}`);
  console.log(`📡 Health Check: http://localhost:${PORT}/api/v1/health`);
  console.log(`=======================================================`);
});

// ── Graceful shutdown (audit gap 22) ────────────────────────────────────────
// On SIGTERM (deploy/stop) or SIGINT (Ctrl+C): stop accepting new requests,
// stop the background workers so no cycle is killed mid-job, give in-flight
// requests up to 10s to finish, then close. Exit 1 if force-destroyed.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return; // second signal = user is impatient
  shuttingDown = true;
  logger.info(`${signal} received — beginning graceful shutdown`);

  workerIntervals.forEach(clearInterval);
  logger.info('Background workers stopped');

  // Stop accepting new connections; wait for in-flight requests.
  server.close(async () => {
    logger.info('HTTP server closed — all in-flight requests drained');
    logger.info('Shutdown complete. Goodbye. 🚲');
    process.exit(0);
  });

  // Don't hang forever on a stuck connection (keep-alive sockets etc.)
  setTimeout(() => {
    logger.warn('Graceful shutdown timed out after 10s — forcing exit');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;

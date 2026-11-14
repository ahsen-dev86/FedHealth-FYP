// backend/src/app.js
// ---------------------------------------------------------------------------
// Express application factory. Wires up:
//   * security middleware (helmet, cors, JSON body limit)
//   * /auth (RBAC + MFA), /help (NGO portal), /model-health (FL telemetry),
//     /lab (lab engineer's node dashboard)
//   * the Module 6 domain API at the root: /reports, /predict, /ocr,
//     /symptoms/parse, /patients/:ref/history, /predictions/:id(/confirm),
//     /nih/clusters, /nih/alerts(/:id/ack), /models(/register|/registry), /labs
//   * compliance: GET /audit and GET /audit/verify (audit:read)
// ---------------------------------------------------------------------------
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./auth/routes');
const helpRoutes = require('./routes/help');
const modelHealthRoutes = require('./routes/modelHealth');
const labRoutes = require('./routes/lab');
const reportRoutes = require('./routes/reports');
const predictionRoutes = require('./routes/predictions');
const nihRoutes = require('./routes/nih');
const adminRoutes = require('./routes/admin');
const adminUserRoutes = require('./routes/adminUsers');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { pool } = require('./db/pool');
const Inference = require('./services/inferenceClient');
const { requireAuth } = require('./middleware/requireAuth');
const { requirePermission } = require('./middleware/rbac');
const { auditAction } = require('./middleware/audit');
const { asyncHandler, errorHandler } = require('./middleware/errors');
const AuditLogs = require('./models/auditLogs');
const { trustProxy, corsOrigins, isProd, rateLimit: limits } = require('./config');

function createApp() {
  const app = express();

  // Trust X-Forwarded-For only from the proxy hop we actually run behind
  // (Vite dev proxy on loopback by default; set TRUST_PROXY for nginx/compose).
  // `true` let any client spoof its IP and bypass the auth rate limiter.
  app.set('trust proxy', trustProxy);

  app.use(helmet()); // sets safe default HTTP security headers (CSP, no-sniff, etc.)

  // CORS: with CORS_ORIGINS set, only those browser origins may call the API
  // (required in production; see config). Unset in development = any origin.
  if (isProd && !corsOrigins.length) {
    console.warn('[fedhealth] CORS_ORIGINS is not set: cross-origin browser calls are refused in production');
  }
  app.use(cors({
    origin: corsOrigins.length ? corsOrigins : !isProd,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Request-Id', 'Content-Disposition'],
    maxAge: 600,
  }));

  // Every response carries a request id, echoed in the server log for 5xx errors.
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });

  // Liveness (process is up) and readiness (database answers) for an orchestrator;
  // registered before the rate limiter so probes are never throttled.
  app.get('/health', (req, res) => res.json({ ok: true, service: 'fedhealth-backend' }));
  app.get('/health/ready', asyncHandler(async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ ok: true, database: 'up' });
    } catch {
      res.status(503).json({ ok: false, database: 'down' });
    }
  }));

  // Whole-API ceiling per client IP; /auth has its own tighter limiter.
  app.use(rateLimit({
    windowMs: limits.windowMs,
    max: limits.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Wait a moment and try again.' },
  }));

  app.use(express.json({ limit: '1mb' })); // parse JSON bodies; cap size to blunt payload-flood abuse

  app.get('/health/inference', asyncHandler(async (req, res) => {
    const status = await Inference.health();
    res.status(status.ok ? 200 : 503).json(status);
  }));

  app.use('/auth', authRoutes);
  app.use('/help', helpRoutes);
  app.use('/model-health', modelHealthRoutes);
  app.use('/lab', labRoutes);
  // Module 6 domain API, mounted at the root (paths used by the frontend client).
  app.use(reportRoutes);
  app.use(predictionRoutes);
  app.use(nihRoutes);
  app.use(adminRoutes);
  app.use(adminUserRoutes);

  // --- Compliance endpoints (admin only) -----------------------------------
  app.get(
    '/audit',
    requireAuth,
    requirePermission('audit:read'),
    auditAction('AUDIT_VIEW'),
    asyncHandler(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const rows = await AuditLogs.list({ limit });
      res.json(rows);
    })
  );

  app.get(
    '/audit/verify',
    requireAuth,
    requirePermission('audit:read'),
    asyncHandler(async (req, res) => {
      // { ok: boolean, broken_at: string|null }
      const result = await AuditLogs.verifyChain();
      res.json(result);
    })
  );

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };

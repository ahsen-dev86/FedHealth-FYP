// backend/src/app.js
// ---------------------------------------------------------------------------
// Express application factory. Wires up:
//   * security middleware (helmet, cors, JSON body limit)
//   * /auth (RBAC + MFA), /help (NGO portal), /model-health (FL telemetry)
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
const reportRoutes = require('./routes/reports');
const predictionRoutes = require('./routes/predictions');
const nihRoutes = require('./routes/nih');
const adminRoutes = require('./routes/admin');
const Inference = require('./services/inferenceClient');
const { requireAuth } = require('./middleware/requireAuth');
const { requirePermission } = require('./middleware/rbac');
const { auditAction } = require('./middleware/audit');
const { asyncHandler, errorHandler } = require('./middleware/errors');
const AuditLogs = require('./models/auditLogs');
const { trustProxy } = require('./config');

function createApp() {
  const app = express();

  // Trust X-Forwarded-For only from the proxy hop we actually run behind
  // (Vite dev proxy on loopback by default; set TRUST_PROXY for nginx/compose).
  // `true` let any client spoof its IP and bypass the auth rate limiter.
  app.set('trust proxy', trustProxy);

  app.use(helmet());
  app.use(cors()); // NOTE: open CORS is fine for the demo; restrict origins in prod.
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => res.json({ ok: true, service: 'fedhealth-backend' }));
  app.get('/health/inference', asyncHandler(async (req, res) => {
    const status = await Inference.health();
    res.status(status.ok ? 200 : 503).json(status);
  }));

  app.use('/auth', authRoutes);
  app.use('/help', helpRoutes);
  app.use('/model-health', modelHealthRoutes);
  // Module 6 domain API, mounted at the root (paths used by the frontend client).
  app.use(reportRoutes);
  app.use(predictionRoutes);
  app.use(nihRoutes);
  app.use(adminRoutes);

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

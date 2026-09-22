// backend/src/app.js
// ---------------------------------------------------------------------------
// Express application factory. For Module 2 this wires up:
//   * security middleware (helmet, cors, JSON body limit)
//   * the /auth router (RBAC + MFA)
//   * two demo protected routes that PROVE RBAC + audit work end-to-end now:
//       GET /audit         — admin-only, lists the immutable log (also audited)
//       GET /audit/verify  — admin-only, verifies the hash chain
// The full domain API (reports, predictions, NIH) is added in Module 6, on top
// of exactly these middleware.
// ---------------------------------------------------------------------------
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./auth/routes');
const helpRoutes = require('./routes/help');
const modelHealthRoutes = require('./routes/modelHealth');
const { requireAuth } = require('./middleware/requireAuth');
const { requirePermission } = require('./middleware/rbac');
const { auditAction } = require('./middleware/audit');
const { asyncHandler, errorHandler } = require('./middleware/errors');
const AuditLogs = require('./models/auditLogs');

function createApp() {
  const app = express();

  // req.ip reflects the real client when running behind the compose reverse proxy.
  app.set('trust proxy', true);

  app.use(helmet());
  app.use(cors()); // NOTE: open CORS is fine for the demo; restrict origins in prod.
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => res.json({ ok: true, service: 'fedhealth-backend' }));

  app.use('/auth', authRoutes);
  app.use('/help', helpRoutes);
  app.use('/model-health', modelHealthRoutes);

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

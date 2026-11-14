// backend/src/routes/help.js
// ---------------------------------------------------------------------------
// The Help Portal (scope: new). Public browsing (no auth) so donors and
// partner organizations can find an NGO's profile and its open supply
// requests; an 'ngo' account can only ever read/write ITS OWN profile and
// requests — every mutating route resolves the caller's ngo_id from
// req.user.id server-side, never trusting a client-supplied ngo id.
// ---------------------------------------------------------------------------
const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission, requireAnyPermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler, HttpError } = require('../middleware/errors');
const Ngos = require('../models/ngos');
const SupplyRequests = require('../models/supplyRequests');

const router = express.Router();

// An NGO manages its own profile ('help:manage_own'). An administrator
// ('help:manage_all') reaches the same routes for ANY NGO by naming it with
// ?ngo=<uuid>; without that right the parameter is ignored, so an NGO account
// can never address another NGO.
const manage = requireAnyPermission('help:manage_own', 'help:manage_all');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The NGO this request acts on: the caller's own, or the one an admin named. */
async function targetNgo(req, { create = true } = {}) {
  if (req.permissions.has('help:manage_all') && !req.permissions.has('help:manage_own')) {
    const id = String(req.query.ngo || '');
    if (!UUID.test(id)) throw new HttpError(400, 'Choose the NGO to manage (?ngo=<id>)');
    const ngo = await Ngos.getById(id);
    if (!ngo) throw new HttpError(404, 'NGO not found');
    return ngo;
  }
  return create
    ? Ngos.getOrCreateForUser(req.user.id, req.user.full_name, req.user.email)
    : Ngos.getByUserId(req.user.id);
}

const profileSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  mission: z.string().max(240).optional(),
  description: z.string().max(4000).optional(),
  logoUrl: z.string().url().max(2048).optional().or(z.literal('')),
  website: z.string().url().max(2048).optional().or(z.literal('')),
  contactEmail: z.string().email().max(254).optional().or(z.literal('')),
  contactPhone: z.string().max(40).optional(),
  district: z.string().max(120).optional(),
  province: z.string().max(120).optional(),
  donationInfo: z.record(z.string().max(200)).optional(),
});

const requestSchema = z.object({
  category: z.enum(['blood', 'medicine', 'equipment', 'funds', 'other']),
  bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  title: z.string().min(3).max(160),
  description: z.string().max(4000).optional(),
  quantity: z.string().max(120).optional(),
  urgency: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  neededBy: z.string().optional(), // ISO date
  district: z.string().max(120).optional(),
  province: z.string().max(120).optional(),
});

const requestUpdateSchema = requestSchema.partial().extend({
  status: z.enum(['open', 'partially_fulfilled', 'fulfilled', 'closed']).optional(),
});

// --- Public browsing ---------------------------------------------------------

router.get('/ngos', asyncHandler(async (req, res) => {
  res.json(await Ngos.listPublic());
}));

// --- Administrator: every NGO, and the verified badge ------------------------
router.get('/admin/ngos', requireAuth, requirePermission('help:manage_all'),
  asyncHandler(async (req, res) => {
    res.json(await Ngos.listForAdmin());
  }));

router.post('/admin/ngos/:id/verified', requireAuth,
  auditAction('NGO_SET_VERIFIED', (req) => ({ type: 'ngo', id: req.params.id })),
  requirePermission('help:manage_all'),
  asyncHandler(async (req, res) => {
    if (!UUID.test(req.params.id)) throw new HttpError(400, 'id must be a UUID');
    const { verified } = z.object({ verified: z.boolean() }).strict().parse(req.body);
    const updated = await Ngos.setVerified(req.params.id, verified);
    if (!updated) throw new HttpError(404, 'NGO not found');
    res.json(updated);
  }));

router.get('/ngos/me', requireAuth, manage,
  asyncHandler(async (req, res) => {
    res.json(await targetNgo(req));
  }));

router.get('/ngos/:id', asyncHandler(async (req, res) => {
  const ngo = await Ngos.getPublicById(req.params.id);
  if (!ngo) throw new HttpError(404, 'NGO not found');
  const requests = await SupplyRequests.listForNgo(req.params.id);
  res.json({ ...ngo, requests });
}));

router.get('/requests', asyncHandler(async (req, res) => {
  const rows = await SupplyRequests.listPublic({
    category: req.query.category || null,
    province: req.query.province || null,
    urgency: req.query.urgency || null,
  });
  res.json(rows);
}));

// --- NGO self-service (own profile + requests only) --------------------------

router.put('/ngos/me', requireAuth, manage,
  auditAction('NGO_UPDATE_PROFILE', (req, res) => ({ type: 'ngo', id: res.locals.ngoId })),
  asyncHandler(async (req, res) => {
    const data = profileSchema.parse(req.body);
    const ngo = await targetNgo(req);
    res.locals.ngoId = ngo.id;
    res.json(await Ngos.updateById(ngo.id, data));
  }));

router.get('/ngos/me/requests', requireAuth, manage,
  asyncHandler(async (req, res) => {
    const ngo = await targetNgo(req);
    res.json(await SupplyRequests.listForNgo(ngo.id));
  }));

router.post('/ngos/me/requests', requireAuth, manage,
  auditAction('NGO_CREATE_REQUEST', (req, res) => ({ type: 'supply_request', id: res.locals.requestId })),
  asyncHandler(async (req, res) => {
    const data = requestSchema.parse(req.body);
    const ngo = await targetNgo(req);
    const created = await SupplyRequests.create(ngo.id, data);
    res.locals.requestId = created.id;
    res.status(201).json(created);
  }));

router.patch('/ngos/me/requests/:id', requireAuth, manage,
  auditAction('NGO_UPDATE_REQUEST', (req) => ({ type: 'supply_request', id: req.params.id })),
  asyncHandler(async (req, res) => {
    const data = requestUpdateSchema.parse(req.body);
    const ngo = await targetNgo(req, { create: false });
    if (!ngo) throw new HttpError(404, 'No NGO profile yet');
    const updated = await SupplyRequests.updateOwned(req.params.id, ngo.id, data);
    if (!updated) throw new HttpError(404, 'Request not found');
    res.json(updated);
  }));

module.exports = router;

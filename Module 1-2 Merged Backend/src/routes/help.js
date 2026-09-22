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
const { requirePermission } = require('../middleware/rbac');
const { auditAction } = require('../middleware/audit');
const { asyncHandler, HttpError } = require('../middleware/errors');
const Ngos = require('../models/ngos');
const SupplyRequests = require('../models/supplyRequests');

const router = express.Router();

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

router.get('/ngos/me', requireAuth, requirePermission('help:manage_own'),
  asyncHandler(async (req, res) => {
    const ngo = await Ngos.getOrCreateForUser(req.user.id, req.user.full_name);
    res.json(ngo);
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

router.put('/ngos/me', requireAuth, requirePermission('help:manage_own'),
  auditAction('NGO_UPDATE_PROFILE', () => ({ type: 'ngo' })),
  asyncHandler(async (req, res) => {
    const data = profileSchema.parse(req.body);
    await Ngos.getOrCreateForUser(req.user.id, req.user.full_name);
    const updated = await Ngos.updateForUser(req.user.id, data);
    res.json(updated);
  }));

router.get('/ngos/me/requests', requireAuth, requirePermission('help:manage_own'),
  asyncHandler(async (req, res) => {
    const ngo = await Ngos.getOrCreateForUser(req.user.id, req.user.full_name);
    res.json(await SupplyRequests.listForNgo(ngo.id));
  }));

router.post('/ngos/me/requests', requireAuth, requirePermission('help:manage_own'),
  auditAction('NGO_CREATE_REQUEST', (req, res) => ({ type: 'supply_request', id: res.locals.requestId })),
  asyncHandler(async (req, res) => {
    const data = requestSchema.parse(req.body);
    const ngo = await Ngos.getOrCreateForUser(req.user.id, req.user.full_name);
    const created = await SupplyRequests.create(ngo.id, data);
    res.locals.requestId = created.id;
    res.status(201).json(created);
  }));

router.patch('/ngos/me/requests/:id', requireAuth, requirePermission('help:manage_own'),
  auditAction('NGO_UPDATE_REQUEST', (req) => ({ type: 'supply_request', id: req.params.id })),
  asyncHandler(async (req, res) => {
    const data = requestUpdateSchema.parse(req.body);
    const ngo = await Ngos.getByUserId(req.user.id);
    if (!ngo) throw new HttpError(404, 'No NGO profile yet');
    const updated = await SupplyRequests.updateOwned(req.params.id, ngo.id, data);
    if (!updated) throw new HttpError(404, 'Request not found');
    res.json(updated);
  }));

module.exports = router;

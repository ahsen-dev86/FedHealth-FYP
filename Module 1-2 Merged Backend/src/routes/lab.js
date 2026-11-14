// backend/src/routes/lab.js
// ---------------------------------------------------------------------------
// Lab engineer portal: GET /lab/dashboard ('lab:dashboard').
//
// A lab engineer (role lab_tech) sees ONLY the lab their account is linked to
// (users.lab_id); the lab is never taken from the request. An admin has no lab
// of their own, so they pick one with ?lab=<uuid> (default: the first by name).
//
// The `lab` block is real (labs table). Everything else comes from
// services/labTelemetry.js, which is sample data until the lab's Docker FL
// client reports; the response says so in `source`. ?simulate=online|degraded|
// offline forces a node state for demos and is honoured only for sample data.
// ---------------------------------------------------------------------------
const express = require('express');
const { z } = require('zod');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/rbac');
const { asyncHandler, HttpError } = require('../middleware/errors');
const Labs = require('../models/labs');
const { sampleLabTelemetry, STATES } = require('../services/labTelemetry');

const router = express.Router();

const query = z.object({
  lab: z.string().uuid().optional(),
  simulate: z.enum(STATES).optional(),
});

router.get('/dashboard', requireAuth, requirePermission('lab:dashboard'),
  asyncHandler(async (req, res) => {
    const q = query.parse(req.query);
    const isAdmin = req.user.role_name === 'admin';

    let lab;
    if (isAdmin) {
      lab = q.lab ? await Labs.findById(q.lab) : (await Labs.listAll())[0];
    } else {
      // A lab engineer is bound to their own lab; ?lab= cannot widen that.
      if (!req.user.lab_id) {
        throw new HttpError(404, 'Your account is not linked to a lab yet. Ask an administrator to link it.');
      }
      if (q.lab && q.lab !== req.user.lab_id) throw new HttpError(403, 'You can only view your own lab');
      lab = await Labs.findById(req.user.lab_id);
    }
    if (!lab) throw new HttpError(404, 'Lab not found');

    const telemetry = sampleLabTelemetry(lab, { simulate: q.simulate });
    res.json({
      lab: {
        id: lab.id, name: lab.name, lims_type: lab.lims_type, district: lab.district, province: lab.province,
        latitude: lab.latitude, longitude: lab.longitude, fl_client_id: lab.fl_client_id, enrolled_at: lab.created_at,
      },
      ...telemetry,
    });
  }));

module.exports = router;

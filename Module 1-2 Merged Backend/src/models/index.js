// backend/src/models/index.js
// ---------------------------------------------------------------------------
// Barrel file: re-exports every model module under one object so routes/
// services can `require('../models').Users` etc. instead of requiring each
// file individually. No logic lives here — just wiring.
// ---------------------------------------------------------------------------
module.exports = {
  Roles:        require('./roles'),
  Permissions:  require('./permissions'),
  Users:        require('./users'),
  Labs:         require('./labs'),
  LabReports:   require('./labReports'),
  MlModels:     require('./mlModels'),
  Predictions:  require('./predictions'),
  AuditLogs:    require('./auditLogs'),
  Alerts:       require('./alerts'),
  NihClusters:  require('./nihClusters'),
  Pseudonymize: require('./pseudonymize'),
  Ngos:            require('./ngos'),
  SupplyRequests:  require('./supplyRequests'),
  ModelHealth:     require('./modelHealth'),
};

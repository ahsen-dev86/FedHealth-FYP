// backend/src/models/index.js
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

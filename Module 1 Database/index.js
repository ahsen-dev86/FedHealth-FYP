// backend/src/models/index.js
// Barrel export so routes can `const { Users, Predictions } = require('../models')`.
module.exports = {
  Roles:      require('./roles'),
  Users:      require('./users'),
  Labs:       require('./labs'),
  LabReports: require('./labReports'),
  MlModels:   require('./mlModels'),
  Predictions:require('./predictions'),
  AuditLogs:  require('./auditLogs'),
  Alerts:     require('./alerts'),
};

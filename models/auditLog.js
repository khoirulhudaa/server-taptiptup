// models/auditLog.js
const auditLogSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  
  // WITHDRAW_REQUESTED, WITHDRAW_TOTP_FAILED, dll
  action:    { type: String, required: true }, 
  details:   { type: mongoose.Schema.Types.Mixed },
  ip:        { type: String },
  timestamp: { type: Date, default: Date.now },
});

auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
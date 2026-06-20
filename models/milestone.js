const mongoose = require('mongoose');
const milestoneSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:       { type: String, required: true },
  targetAmount:{ type: Number, required: true },
  currentAmount:{ type: Number, default: 0 },
  reached:     { type: Boolean, default: false },
  reachedAt:   { type: Date, default: null },
  order:       { type: Number, default: 0 },
  period: { 
    type: String, 
    enum: ['alltime', 'today', 'thismonth', 'since'], // ← tambah 'since'
    default: 'alltime' 
  },
  periodSince: { type: Date, default: null }
}, { timestamps: true });
module.exports = mongoose.model('Milestone', milestoneSchema);
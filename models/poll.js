const mongoose = require('mongoose');

const pollOptionSchema = new mongoose.Schema({
  text: { type: String, required: true },
  votes: { type: Number, default: 0 },
}, { _id: true });

const pollSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  question: { type: String, required: true },
  options: [pollOptionSchema],
  status: { type: String, enum: ['active', 'closed'], default: 'active' },
  
  // Voters — simpan email untuk 1 email 1 vote
  voters: [{ type: String }], // array of email
  
  // Tampilan OBS
  showResults: { type: Boolean, default: true }, // tampilkan % di OBS saat voting berlangsung
}, { timestamps: true });

module.exports = mongoose.model('Poll', pollSchema);
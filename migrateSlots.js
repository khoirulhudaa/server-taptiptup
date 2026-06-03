const mongoose = require('mongoose');
const { OverlaySetting } = require('./models');
require('dotenv').config();

async function migrateOne() {
  await mongoose.connect(process.env.MONGO_URI);
  
  const result = await OverlaySetting.updateOne(
    { 
      _id: new mongoose.Types.ObjectId("69fea6813c6de83aa1f5ab89"),
      slot: { $exists: false }
    },
    { 
      $set: { slot: 'A' } 
    }
  );
  
  console.log('Result:', result);
  // { matchedCount: 1, modifiedCount: 1 } kalau berhasil
  
  await mongoose.disconnect();
}

migrateOne();
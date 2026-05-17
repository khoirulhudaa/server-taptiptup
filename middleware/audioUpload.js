// middleware/audioUpload.js
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const { v2: cloudinary } = require('cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isAudio = file.mimetype.startsWith('audio/');
    return {
      folder:        isAudio ? 'taptiptup/audio' : 'taptiptup/images',
      resource_type: isAudio ? 'video' : 'image', // Cloudinary pakai 'video' untuk semua audio
      public_id:     `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
    'audio/m4a', 'audio/aac', 'audio/webm',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format file tidak didukung'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

module.exports = upload;
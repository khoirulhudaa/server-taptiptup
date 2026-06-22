// backend/utils/soundcloud.js
const axios = require('axios');

const SOUNDCLOUD_CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;

if (!SOUNDCLOUD_CLIENT_ID) {
  console.warn('⚠️ SOUNDCLOUD_CLIENT_ID belum di-set di .env');
}

/**
 * Resolve SoundCloud URL → track data
 */
exports.resolveSoundCloudTrack = async (url) => {
  if (!SOUNDCLOUD_CLIENT_ID) {
    throw new Error('SoundCloud Client ID belum dikonfigurasi');
  }

  try {
    // Gunakan endpoint resolve resmi SoundCloud
    const resolveRes = await axios.get('https://api.soundcloud.com/resolve', {
      params: {
        url: url.trim(),    
        client_id: SOUNDCLOUD_CLIENT_ID,
      },
      timeout: 8000,
    });

    const track = resolveRes.data;

    if (!track || track.kind !== 'track') {
      throw new Error('Bukan track SoundCloud');
    }

    // Ambil stream URL (transcoding)
    let streamUrl = null;
    if (track.streamable && track.stream_url) {
      streamUrl = `${track.stream_url}?client_id=${SOUNDCLOUD_CLIENT_ID}`;
    }

    return {
      id: track.id,
      title: track.title,
      artist: track.user?.username || track.artist,
      artworkUrl: track.artwork_url || track.user?.avatar_url,
      duration: Math.floor(track.duration / 1000), // detik
      permalinkUrl: track.permalink_url,
      streamUrl,
      streamable: track.streamable,
      public: track.sharing === 'public',
      genre: track.genre,
      createdAt: track.created_at,
    };
  } catch (err) {
    console.error('[SoundCloud Resolve Error]', err.response?.data || err.message);

    if (err.response?.status === 404) {
      throw new Error('Track SoundCloud tidak ditemukan');
    }
    if (err.response?.status === 403) {
      throw new Error('Track ini tidak bisa diakses (private / dibatasi)');
    }

    throw err;
  }
};

/**
 * Validasi URL SoundCloud
 */
exports.isSoundCloudUrl = (url) => {
  if (!url) return false;
  return /^(https?:\/\/)?(www\.|m\.)?soundcloud\.com\//i.test(url);
};
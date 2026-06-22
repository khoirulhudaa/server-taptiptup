// utils/soundcloud.js
const axios = require('axios');

const SOUNDCLOUD_CLIENT_ID = process.env.SOUNDCLOUD_CLIENT_ID;

const isSoundCloudUrl = (url) => {
  if (!url) return false;
  return /^(https?:\/\/)?(www\.|m\.)?soundcloud\.com\//i.test(url);
};

const resolveSoundCloudTrack = async (url) => {
  if (!SOUNDCLOUD_CLIENT_ID) {
    throw new Error('SOUNDCLOUD_CLIENT_ID belum diset di .env server');
  }

  const res = await axios.get('https://api.soundcloud.com/resolve', {
    params: { url, client_id: SOUNDCLOUD_CLIENT_ID },
  });

  const track = res.data;
  if (!track || track.kind !== 'track') {
    throw new Error('Link bukan track SoundCloud yang valid');
  }

  return {
    id: track.id,
    title: track.title,
    artist: track.user?.username || 'Unknown Artist',
    artworkUrl: (track.artwork_url || track.user?.avatar_url || '')
      .replace('-large', '-t500x500'),
    duration: Math.round((track.duration || 0) / 1000), // ms → detik
    permalinkUrl: track.permalink_url,
    streamable: track.streamable !== false,
  };
};

module.exports = { isSoundCloudUrl, resolveSoundCloudTrack };
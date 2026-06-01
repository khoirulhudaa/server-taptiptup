const { User } = require('../models');
const axios = require('axios');
require('dotenv').config();

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

const getChannelIdFromUrl = (url) => {
  if (!url) return null;
  const match = url.match(/(?:channel\/|c\/|user\/|@)([^/?&]+)/);
  return match ? match[1] : null;
};

exports.getPublicStreamers = async (req, res) => {
  try {
    const users = await User.find({
      youtube: { $ne: null, $ne: '' }
    }).select('username youtube profilePicture bio donateIntro');

    const result = [];

    for (const user of users) {
      const channelIdOrHandle = getChannelIdFromUrl(user.youtube);
      if (!channelIdOrHandle) continue;

      let isLive = false;
      let liveVideoId = null;
      let thumbnail = null;

      try {
        const searchRes = await axios.get('https://www.googleapis.com/youtube/v3/search', {
          params: {
            part: 'snippet',
            channelId: channelIdOrHandle,
            eventType: 'live',
            type: 'video',
            key: YOUTUBE_API_KEY,
          }
        });

        if (searchRes.data.items?.length > 0) {
          isLive = true;
          liveVideoId = searchRes.data.items[0].id.videoId;
          thumbnail = searchRes.data.items[0].snippet.thumbnails.high.url;
        }
      } catch (err) {
        console.error(`YouTube API error for ${user.username}:`, err.message);
      }

      // ✅ Hanya push jika sedang LIVE
      if (isLive) {
        result.push({
          id: user._id,
          username: user.username,
          youtubeUrl: user.youtube,
          profilePicture: user.profilePicture || '/default-avatar.png',
          bio: user.bio || '',
          donateIntro: user.donateIntro,
          isLive,
          liveVideoId,
          thumbnail: thumbnail || null,
        });
      }
    }

    res.json({ 
      success: true, 
      streamers: result,
      totalLive: result.length 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Gagal mengambil data streamer' });
  }
};
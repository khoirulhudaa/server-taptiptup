const fetch = require('node-fetch');

const VOICES = [
  { name: 'id-ID-GadisNeural',  lang: 'id', label: '🇮🇩 Gadis – Perempuan' },
  { name: 'id-ID-ArdiNeural',   lang: 'id', label: '🇮🇩 Ardi – Laki-laki'  },
  { name: 'en-US-JennyNeural',  lang: 'en', label: '🇺🇸 Jenny – Perempuan'  },
  { name: 'en-US-GuyNeural',    lang: 'en', label: '🇺🇸 Guy – Laki-laki'    },
  { name: 'ja-JP-NanamiNeural', lang: 'ja', label: '🇯🇵 Nanami – Perempuan' },
  { name: 'ko-KR-SunHiNeural',  lang: 'ko', label: '🇰🇷 SunHi – Perempuan'  },
];

const LANG_MAP = {
  'id-ID-GadisNeural':  'id',
  'id-ID-ArdiNeural':   'id',
  'en-US-JennyNeural':  'en',
  'en-US-GuyNeural':    'en',
  'en-GB-SoniaNeural':  'en',
  'ja-JP-NanamiNeural': 'ja',
  'ko-KR-SunHiNeural':  'ko',
};

exports.getVoiceList = (req, res) => res.json({ voices: VOICES });
exports.synthesize = async (req, res) => {
  try {
    const { 
      text = '', 
      voiceName = 'id-ID-GadisNeural',
      rate = 1.35   // ← Tambahkan ini
    } = req.body;

    const cleanText = text.trim().substring(0, 200);
    if (!cleanText) return res.status(400).json({ message: 'Text kosong' });

    const lang = LANG_MAP[voiceName] || 'id';

    // Google TTS mendukung parameter ttsspeed
    const speedParam = rate !== 1.35 ? `&ttsspeed=${rate}` : '';

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleanText)}&tl=${lang}&client=tw-ob${speedParam}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://translate.google.com/',
      },
    });

    if (!response.ok) throw new Error(`Google TTS HTTP ${response.status}`);

    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-cache');
    res.set('Access-Control-Allow-Origin', '*');
    response.body.pipe(res);

  } catch (err) {
    console.error('[TTS]', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'TTS gagal', error: err.message });
    }
  }
};
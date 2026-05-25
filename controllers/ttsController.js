const WebSocket = require('ws');
const { randomUUID } = require('crypto');

const VOICES = [
  { name: 'id-ID-GadisNeural',  gender: 'Female', lang: 'id-ID', label: '🇮🇩 Gadis – Perempuan (Neural)' },
  { name: 'id-ID-ArdiNeural',   gender: 'Male',   lang: 'id-ID', label: '🇮🇩 Ardi – Laki-laki (Neural)' },
  { name: 'en-US-JennyNeural',  gender: 'Female', lang: 'en-US', label: '🇺🇸 Jenny – Perempuan (Neural)' },
  { name: 'en-US-GuyNeural',    gender: 'Male',   lang: 'en-US', label: '🇺🇸 Guy – Laki-laki (Neural)' },
  { name: 'en-GB-SoniaNeural',  gender: 'Female', lang: 'en-GB', label: '🇬🇧 Sonia – Perempuan (Neural)' },
  { name: 'ja-JP-NanamiNeural', gender: 'Female', lang: 'ja-JP', label: '🇯🇵 Nanami – Perempuan (Neural)' },
  { name: 'ko-KR-SunHiNeural',  gender: 'Female', lang: 'ko-KR', label: '🇰🇷 SunHi – Perempuan (Neural)' },
];

exports.getVoiceList = (req, res) => {
  res.json({ voices: VOICES });
};

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function synthesizeEdgeTTS({ text, voice, rate, pitch, volume }) {
  return new Promise((resolve, reject) => {
    const connectionId = randomUUID().replace(/-/g, '').toUpperCase();
    const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4&ConnectionId=${connectionId}`;

    const ws = new WebSocket(url, {
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      },
    });

    const audioChunks = [];
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.terminate();
        reject(new Error('TTS timeout'));
      }
    }, 15000);

    ws.on('open', () => {
      // 1. Kirim config
      const configMsg = `X-Timestamp:${new Date().toISOString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}`;
      ws.send(configMsg);

      // 2. Kirim SSML
      const requestId = randomUUID().replace(/-/g, '').toUpperCase();
      const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${voice}'><prosody rate='${rate}' pitch='${pitch}' volume='${volume}'>${escapeXml(text)}</prosody></voice></speak>`;
      const ssmlMsg = `X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${new Date().toISOString()}Z\r\nPath:ssml\r\n\r\n${ssml}`;
      ws.send(ssmlMsg);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Audio binary — cari header separator "Path:audio\r\n\r\n"
        const separator = Buffer.from('Path:audio\r\n\r\n');
        const idx = data.indexOf(separator);
        if (idx !== -1) {
          audioChunks.push(data.slice(idx + separator.length));
        }
        return;
      }

      const msg = data.toString();
      if (msg.includes('Path:turn.end')) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          resolve(Buffer.concat(audioChunks));
        }
      }
    });

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    ws.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error('WebSocket closed without audio'));
        }
      }
    });
  });
}

exports.synthesize = async (req, res) => {
  try {
    const { text = '', voiceName = 'id-ID-GadisNeural', rate = '+0%' } = req.body;
    const cleanText = text.trim().substring(0, 500);
    if (!cleanText) return res.status(400).json({ message: 'Text kosong' });

    // Map voice ke ResponsiveVoice
    const voiceMap = {
      'id-ID-GadisNeural': 'Indonesian Female',
      'id-ID-ArdiNeural':  'Indonesian Male',
      'en-US-JennyNeural': 'US English Female',
      'en-US-GuyNeural':   'US English Male',
    };
    const rvVoice = voiceMap[voiceName] || 'Indonesian Female';

    const url = `https://code.responsivevoice.org/getvoice.php?t=${encodeURIComponent(cleanText)}&tl=id&sv=&vn=&pitch=0.5&rate=0.5&vol=1&lang=${rvVoice}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`ResponsiveVoice HTTP ${response.status}`);

    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'no-cache');
    res.set('Access-Control-Allow-Origin', '*');
    response.body.pipe(res);
  } catch (err) {
    console.error('[TTS]', err);
    if (!res.headersSent) res.status(500).json({ message: 'TTS gagal', error: err.message });
  }
};
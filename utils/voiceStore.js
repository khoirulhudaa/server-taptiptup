// utils/voiceStore.js
// In-memory store untuk voice message — tidak ada file, tidak ada DB
// Data otomatis hilang setelah TTL (default 30 menit)

const TTL_MS = 30 * 60 * 1000; // 30 menit

// Map<id, { buffer, mimeType, expiresAt }>
const store = new Map();

// Cleanup otomatis setiap 5 menit — hapus entry yang sudah expired
const cleanup = () => {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(id);
      console.log(`[VoiceStore] Expired & deleted: ${id}`);
    }
  }
};
setInterval(cleanup, 5 * 60 * 1000);

/**
 * Simpan voice buffer ke memory
 * @param {Buffer} buffer
 * @param {string} mimeType  e.g. 'audio/webm'
 * @returns {string} id  — gunakan sebagai key untuk fetch
 */
const save = (buffer, mimeType) => {
  const id = `vc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  store.set(id, {
    buffer,
    mimeType,
    expiresAt: Date.now() + TTL_MS,
  });
  console.log(`[VoiceStore] Saved: ${id} (${buffer.length} bytes, TTL 30m)`);
  return id;
};

/**
 * Ambil voice entry
 * @param {string} id
 * @returns {{ buffer, mimeType } | null}
 */
const get = (id) => {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(id);
    return null;
  }
  return { buffer: entry.buffer, mimeType: entry.mimeType };
};

/**
 * Hapus manual (opsional, misal setelah overlay selesai putar)
 */
const remove = (id) => store.delete(id);

const size = () => store.size;

module.exports = { save, get, remove, size };
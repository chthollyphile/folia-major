// electron/ytm/trackBuffer.cjs
// One download fills a track's buffer front to back, and every reader (the audio element, the
// caches, automix) is answered from it.

const READ_CHUNK_BYTES = 256 * 1024;

class TrackBuffer {
  constructor(total, mimeType) {
    this.total = total;
    this.mimeType = mimeType;
    this.bytes = Buffer.alloc(total);
    this.filled = 0;
    this.error = null;
    this.waiters = [];
  }

  wake() {
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  push(chunk) {
    if (this.filled + chunk.length > this.total) throw new Error('Track is longer than its declared length');
    this.bytes.set(chunk, this.filled);
    this.filled += chunk.length;
    this.wake();
  }

  fail(error) {
    this.error = error instanceof Error ? error : new Error('Track download failed');
    this.wake();
  }

  // Streams bytes [start, end], waiting for the download where it has not reached them yet.
  // A failed download errors the stream, which the reader sees as a network error.
  read(start, end) {
    let position = start;
    let cancelled = false;
    return new ReadableStream({
      pull: async controller => {
        while (this.filled <= position && !this.error && !cancelled) {
          await new Promise(resolve => this.waiters.push(resolve));
        }
        if (cancelled) return;
        if (this.filled <= position) { controller.error(this.error); return; }
        const upTo = Math.min(this.filled, end + 1, position + READ_CHUNK_BYTES);
        controller.enqueue(new Uint8Array(this.bytes.subarray(position, upTo)));
        position = upTo;
        if (position > end) controller.close();
      },
      cancel: () => { cancelled = true; },
    });
  }
}

// Keeps the most recently used entries within a byte budget; the newest entry always stays.
// `onDrop(value)` is told about every entry that leaves, however it leaves.
function createByteLru(maxBytes, onDrop = () => {}) {
  const entries = new Map();
  let total = 0;
  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key, value, size) {
      this.delete(key);
      entries.set(key, { value, size });
      total += size;
      for (const [oldKey, old] of entries) {
        if (total <= maxBytes || oldKey === key) break;
        entries.delete(oldKey);
        total -= old.size;
        onDrop(old.value);
      }
    },
    delete(key) {
      const entry = entries.get(key);
      if (!entry) return;
      entries.delete(key);
      total -= entry.size;
      onDrop(entry.value);
    },
    clear() {
      const dropped = [...entries.values()];
      entries.clear();
      total = 0;
      for (const entry of dropped) onDrop(entry.value);
    },
    keys() { return [...entries.keys()]; },
    get size() { return entries.size; },
  };
}

module.exports = { TrackBuffer, createByteLru };

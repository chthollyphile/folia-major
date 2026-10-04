'use strict';

// electron/videoExportMp4.cjs
// Chromium MediaRecorder emits fragmented MP4 with unfinished movie/track durations.
// Finalize those headers from the actual sample timeline; encoded media and fragment offsets stay intact.
const fail = (message) => { throw new Error(`Invalid recorded MP4: ${message}`); };
const requireBytes = (box, offset, count) => {
  if (offset < box.data || offset + count > box.end) fail(`truncated ${box.type}`);
};
function boxes(buffer, start, end) {
  const result = [];
  for (let offset = start; offset < end;) {
    if (end - offset < 8) fail('truncated box header');
    let size = buffer.readUInt32BE(offset), header = 8;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (size === 1) {
      if (end - offset < 16) fail(`truncated ${type} size`);
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) fail(`oversized ${type}`);
      size = Number(large); header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || size > end - offset) fail(`invalid ${type} size`);
    result.push({ type, data: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}
const child = (buffer, box, type) => boxes(buffer, box.data, box.end).find(item => item.type === type);
const requiredChild = (buffer, box, type) => child(buffer, box, type) || fail(`missing ${type}`);
function fullBox(buffer, box) {
  requireBytes(box, box.data, 4);
  const version = buffer[box.data];
  if (version !== 0 && version !== 1) fail(`unsupported ${box.type} version`);
  return { version, flags: buffer.readUInt32BE(box.data) & 0xffffff };
}
function durationField(buffer, box, track = false) {
  const { version } = fullBox(buffer, box);
  const offset = box.data + (track ? (version ? 28 : 20) : (version ? 24 : 16));
  requireBytes(box, offset, version ? 8 : 4);
  const timescale = track ? null : buffer.readUInt32BE(offset - 4);
  if (!track && !timescale) fail('zero timescale');
  return { offset, version, timescale };
}
const uint = (buffer, box, offset) => {
  requireBytes(box, offset, 4);
  return buffer.readUInt32BE(offset);
};
const scaleUp = (value, from, to) => (value * BigInt(to) + BigInt(from) - 1n) / BigInt(from);

/** Mutates only verified duration fields, after validating every fragment. Non-fragmented inputs pass through. */
function finalizeVideoExport(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError('Expected video buffer');
  if (buffer.length < 8 || buffer.toString('ascii', 4, 8) !== 'ftyp') return buffer;
  const top = boxes(buffer, 0, buffer.length);
  if (!top.some(box => box.type === 'moof')) return buffer;
  const movies = top.filter(box => box.type === 'moov');
  if (movies.length !== 1) fail('expected one moov');
  const moov = movies[0];
  const movie = durationField(buffer, requiredChild(buffer, moov, 'mvhd'));
  const tracks = new Map();
  for (const trak of boxes(buffer, moov.data, moov.end).filter(box => box.type === 'trak')) {
    const tkhd = requiredChild(buffer, trak, 'tkhd');
    const { version } = fullBox(buffer, tkhd);
    const id = uint(buffer, tkhd, tkhd.data + (version ? 20 : 12));
    const mdia = requiredChild(buffer, trak, 'mdia');
    if (!id || tracks.has(id)) fail('invalid track ID');
    // Edit lists need their own movie-time mapping; never silently overwrite an unfamiliar timeline.
    if (child(buffer, trak, 'edts')) fail('fragmented edit lists are unsupported');
    tracks.set(id, { media: durationField(buffer, requiredChild(buffer, mdia, 'mdhd')),
      header: durationField(buffer, tkhd, true), end: 0n, decodeEnd: 0n, samples: 0, defaultDuration: 0 });
  }
  if (!tracks.size) fail('no tracks');
  const mvex = child(buffer, moov, 'mvex');
  if (mvex) for (const trex of boxes(buffer, mvex.data, mvex.end).filter(box => box.type === 'trex')) {
    const id = uint(buffer, trex, trex.data + 4);
    const track = tracks.get(id) || fail('unknown trex track');
    track.defaultDuration = uint(buffer, trex, trex.data + 12);
  }
  for (const moof of top.filter(box => box.type === 'moof')) {
    for (const traf of boxes(buffer, moof.data, moof.end).filter(box => box.type === 'traf')) {
      const tfhd = requiredChild(buffer, traf, 'tfhd'), { flags } = fullBox(buffer, tfhd);
      const id = uint(buffer, tfhd, tfhd.data + 4), track = tracks.get(id) || fail('unknown fragment track');
      let offset = tfhd.data + 8;
      if (flags & 1) offset += 8;
      if (flags & 2) offset += 4;
      const defaultDuration = flags & 8 ? uint(buffer, tfhd, offset) : track.defaultDuration;
      const tfdt = child(buffer, traf, 'tfdt');
      let decode = track.decodeEnd;
      if (tfdt) {
        const { version } = fullBox(buffer, tfdt);
        requireBytes(tfdt, tfdt.data + 4, version ? 8 : 4);
        decode = version ? buffer.readBigUInt64BE(tfdt.data + 4) : BigInt(buffer.readUInt32BE(tfdt.data + 4));
      }
      for (const trun of boxes(buffer, traf.data, traf.end).filter(box => box.type === 'trun')) {
        const { flags: runFlags, version } = fullBox(buffer, trun);
        const count = uint(buffer, trun, trun.data + 4);
        let cursor = trun.data + 8;
        if (runFlags & 1) cursor += 4;
        if (runFlags & 4) cursor += 4;
        const width = [0x100, 0x200, 0x400, 0x800].filter(flag => runFlags & flag).length * 4;
        requireBytes(trun, cursor, count * width);
        if (!count) continue;
        if (!(runFlags & 0x100) && !defaultDuration) fail('missing sample duration');
        if (!width) {
          decode += BigInt(count) * BigInt(defaultDuration);
          if (decode > track.end) track.end = decode;
        } else for (let index = 0; index < count; index++) {
          const duration = runFlags & 0x100 ? buffer.readUInt32BE(cursor) : defaultDuration;
          if (runFlags & 0x100) cursor += 4;
          if (runFlags & 0x200) cursor += 4;
          if (runFlags & 0x400) cursor += 4;
          let composition = 0;
          if (runFlags & 0x800) {
            composition = version ? buffer.readInt32BE(cursor) : buffer.readUInt32BE(cursor);
            cursor += 4;
          }
          const end = decode + BigInt(duration) + BigInt(composition);
          if (end > track.end) track.end = end;
          decode += BigInt(duration);
          if (decode > track.end) track.end = decode;
        }
        track.samples += count;
      }
      track.decodeEnd = decode;
    }
  }
  const patches = [];
  let movieDuration = 0n;
  for (const track of tracks.values()) {
    const duration = scaleUp(track.end, track.media.timescale, movie.timescale);
    patches.push([track.media, track.end], [track.header, duration]);
    if (duration > movieDuration) movieDuration = duration;
  }
  if (!movieDuration) fail('no timed samples');
  patches.push([movie, movieDuration]);
  const mehd = mvex && child(buffer, mvex, 'mehd');
  if (mehd) {
    const { version } = fullBox(buffer, mehd);
    requireBytes(mehd, mehd.data + 4, version ? 8 : 4);
    patches.push([{ offset: mehd.data + 4, version }, movieDuration]);
  }
  for (const [field, duration] of patches)
    if (duration < 0n || duration > (field.version ? 0xffffffffffffffffn : 0xffffffffn)) fail('duration overflow');
  for (const [field, duration] of patches) {
    if (field.version) buffer.writeBigUInt64BE(duration, field.offset);
    else buffer.writeUInt32BE(Number(duration), field.offset);
  }
  return buffer;
}

module.exports = { finalizeVideoExport };

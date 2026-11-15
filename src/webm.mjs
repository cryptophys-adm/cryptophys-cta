// WebM duration (the YouTube/TikTok videos, src/video.mjs). A browser's MediaRecorder writes a WebM without a
// Duration (it streams), and players and upload checks then see none. This adds the Segment Info's Duration element
// (EBML ID 0x4489, an 8-byte float in TimecodeScale units, 1 ms by default), the way fix-webm-duration does. Pure.
const ID = Object.freeze({ EBML: 0x1a45dfa3, SEGMENT: 0x18538067, INFO: 0x1549a966, DURATION: 0x4489, TIMECODE_SCALE: 0x2ad7b1 });

/** An EBML variable-size integer at `i`: { value, length } (the ID form keeps its marker bit). */
function vint(b, i, { marker = false } = {}) {
  const first = b[i];
  if (first === undefined || first === 0) return null;
  let length = 1, mask = 0x80;
  while (!(first & mask)) { length += 1; mask >>= 1; }
  if (i + length > b.length) return null;
  let value = marker ? first : first & (mask - 1);
  for (let k = 1; k < length; k += 1) value = value * 256 + b[i + k];
  return { value, length };
}
const UNKNOWN = (len) => 2 ** (7 * len) - 1;

/** Reads the elements directly inside [start, end): [{ id, at, dataAt, size, unknown }]. Stops at an unknown size. */
function children(b, start, end) {
  const out = [];
  let i = start;
  while (i < end) {
    const id = vint(b, i, { marker: true });
    if (!id) break;
    const size = vint(b, i + id.length);
    if (!size) break;
    const dataAt = i + id.length + size.length;
    const unknown = size.value === UNKNOWN(size.length);
    out.push({ id: id.value, at: i, sizeAt: i + id.length, sizeLength: size.length, dataAt, size: size.value, unknown });
    if (unknown) break;
    i = dataAt + size.value;
  }
  return out;
}

/** The video's Duration in ms, or null (none written). */
export function webmDuration(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const seg = children(b, 0, b.length).find((e) => e.id === ID.SEGMENT);
  if (!seg) return null;
  const info = children(b, seg.dataAt, b.length).find((e) => e.id === ID.INFO);
  if (!info) return null;
  const d = children(b, info.dataAt, info.dataAt + info.size).find((e) => e.id === ID.DURATION);
  if (!d) return null;
  const view = new DataView(b.buffer, b.byteOffset + d.dataAt, d.size);
  return d.size === 8 ? view.getFloat64(0) : d.size === 4 ? view.getFloat32(0) : null;
}

/**
 * The WebM with its Duration set to `ms` (in TimecodeScale units; the recorder's default scale is 1 ms). Throws when
 * the file is not the shape a recorder writes (no Segment Info, or an Info whose size field cannot grow in place).
 */
export function setWebmDuration(bytes, ms) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!(Number.isFinite(ms) && ms > 0)) throw new Error("a duration in ms is needed");
  if (vint(b, 0, { marker: true })?.value !== ID.EBML) throw new Error("not a WebM (no EBML header)");
  const seg = children(b, 0, b.length).find((e) => e.id === ID.SEGMENT);
  if (!seg) throw new Error("no Segment");
  if (!seg.unknown) throw new Error("a Segment with a known size is not supported");
  const info = children(b, seg.dataAt, b.length).find((e) => e.id === ID.INFO);
  if (!info || info.unknown) throw new Error("no Segment Info");
  const inside = children(b, info.dataAt, info.dataAt + info.size);
  const scale = inside.find((e) => e.id === ID.TIMECODE_SCALE);
  if (scale) {
    let ns = 0;
    for (let k = 0; k < scale.size; k += 1) ns = ns * 256 + b[scale.dataAt + k];
    ms = (ms * 1_000_000) / (ns || 1_000_000);
  }
  const existing = inside.find((e) => e.id === ID.DURATION);
  if (existing && existing.size === 8) {
    const out = b.slice();
    new DataView(out.buffer, existing.dataAt, 8).setFloat64(0, ms);
    return out;
  }
  if (existing) throw new Error("an unusual Duration is already there");
  // The new element: ID 0x4489, size 8 (0x88), a big-endian float64.
  const element = new Uint8Array(11);
  element.set([0x44, 0x89, 0x88]);
  new DataView(element.buffer).setFloat64(3, ms);
  const newSize = info.size + element.length;
  if (newSize >= UNKNOWN(info.sizeLength)) throw new Error("the Segment Info cannot grow in place");
  const sizeField = new Uint8Array(info.sizeLength);
  let v = newSize;
  for (let k = info.sizeLength - 1; k >= 0; k -= 1) { sizeField[k] = v & 0xff; v = Math.floor(v / 256); }
  sizeField[0] |= 0x80 >> (info.sizeLength - 1);
  const end = info.dataAt + info.size;
  const out = new Uint8Array(b.length + element.length);
  out.set(b.subarray(0, info.sizeAt), 0);
  out.set(sizeField, info.sizeAt);
  out.set(b.subarray(info.dataAt, end), info.dataAt);
  out.set(element, end);
  out.set(b.subarray(end), end + element.length);
  return out;
}

/** Version 2 binary protocol. Views preserve offsets for Node buffers and browser frames. */
const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const uint = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
export function decodeMicrophone(bytes: Uint8Array) {
  if (bytes.length < 27 || bytes.length > 4096 || bytes[0] !== 1) return null;
  const v = view(bytes),
    samples = v.getUint32(13, true),
    capturedAt = v.getFloat64(17, true);
  if (
    v.getUint32(9, true) !== 16000 ||
    !samples ||
    samples > 1600 ||
    bytes.length !== 25 + samples * 2 ||
    !Number.isFinite(capturedAt)
  )
    return null;
  return {
    epoch: v.getUint32(1, true),
    seq: v.getUint32(5, true),
    samples,
    capturedAt,
    pcm: bytes.subarray(25),
  };
}
export function encodeMicrophone(
  epoch: number,
  seq: number,
  capturedAt: number,
  pcm: Uint8Array,
) {
  if (
    !uint(epoch) ||
    !uint(seq) ||
    !Number.isFinite(capturedAt) ||
    !pcm.length ||
    pcm.length % 2 ||
    pcm.length > 3200
  )
    throw new Error("Invalid microphone frame");
  const packet = new Uint8Array(25 + pcm.length),
    v = view(packet);
  v.setUint8(0, 1);
  v.setUint32(1, epoch, true);
  v.setUint32(5, seq, true);
  v.setUint32(9, 16000, true);
  v.setUint32(13, pcm.length / 2, true);
  v.setFloat64(17, capturedAt, true);
  packet.set(pcm, 25);
  return packet;
}
export function decodeVideo(bytes: Uint8Array) {
  if (bytes.length < 21 || bytes.length > 64000 || bytes[0] !== 3) return null;
  const v = view(bytes),
    capturedAt = v.getFloat64(9, true);
  if (
    !Number.isFinite(capturedAt) ||
    bytes[17] !== 0xff ||
    bytes[18] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    return null;
  return {
    epoch: v.getUint32(1, true),
    seq: v.getUint32(5, true),
    capturedAt,
    jpeg: bytes.subarray(17),
  };
}
export function encodeVideo(
  epoch: number,
  seq: number,
  capturedAt: number,
  jpeg: Uint8Array,
) {
  if (
    !uint(epoch) ||
    !uint(seq) ||
    !Number.isFinite(capturedAt) ||
    jpeg.length > 63983
  )
    throw new Error("Invalid video frame");
  const packet = new Uint8Array(17 + jpeg.length),
    v = view(packet);
  v.setUint8(0, 3);
  v.setUint32(1, epoch, true);
  v.setUint32(5, seq, true);
  v.setFloat64(9, capturedAt, true);
  packet.set(jpeg, 17);
  return packet;
}
export function decodeJudgeAudio(bytes: Uint8Array) {
  if (
    bytes.length < 21 ||
    bytes.length > 131072 ||
    bytes[0] !== 2 ||
    (bytes.length - 17) % 4
  )
    return null;
  const v = view(bytes),
    offset = v.getUint32(13, true),
    samples = (bytes.length - 17) / 4;
  if (v.getUint32(9, true) !== 44100 || offset + samples > 44100 * 8)
    return null;
  const pcm = new Float32Array(Uint8Array.from(bytes.subarray(17)).buffer);
  if (pcm.some((sample) => !Number.isFinite(sample))) return null;
  return {
    epoch: v.getUint32(1, true),
    seq: v.getUint32(5, true),
    offset,
    pcm,
  };
}
export function encodeJudgeAudio(
  epoch: number,
  seq: number,
  offset: number,
  pcm: Uint8Array,
) {
  if (
    !uint(epoch) ||
    !uint(seq) ||
    !uint(offset) ||
    !pcm.length ||
    pcm.length % 4 ||
    offset + pcm.length / 4 > 44100 * 8
  )
    throw new Error("Invalid judge frame");
  const packet = new Uint8Array(17 + pcm.length),
    v = view(packet);
  v.setUint8(0, 2);
  v.setUint32(1, epoch, true);
  v.setUint32(5, seq, true);
  v.setUint32(9, 44100, true);
  v.setUint32(13, offset, true);
  packet.set(pcm, 17);
  return packet;
}

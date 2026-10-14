/** Protocol 4. Every capture frame carries its purpose at capture time. */
const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const uint = (n: number) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
export type CapturePurpose = "social" | "gameplay" | "private" | "health";
const purposes: CapturePurpose[] = ["social", "gameplay", "private", "health"];
export type CaptureTag = {
  purpose: CapturePurpose;
  inputEpoch: number;
  end?: boolean;
};
const MIC_HEADER = 31;
export function decodeMicrophone(bytes: Uint8Array) {
  if (
    bytes.length < MIC_HEADER ||
    bytes.length > MIC_HEADER + 3200 ||
    bytes[0] !== 1
  )
    return null;
  const v = view(bytes),
    samples = v.getUint32(13, true),
    capturedAt = v.getFloat64(17, true);
  const purpose = purposes[bytes[25]],
    end = bytes[30] === 1;
  if (
    v.getUint32(9, true) !== 16000 ||
    samples > 1600 ||
    (!samples && !end && purpose !== "health") ||
    bytes.length !== MIC_HEADER + samples * 2 ||
    !Number.isFinite(capturedAt) ||
    !purpose ||
    bytes[30] > 1 ||
    (end && samples)
  )
    return null;
  return {
    epoch: v.getUint32(1, true),
    seq: v.getUint32(5, true),
    samples,
    capturedAt,
    purpose,
    inputEpoch: v.getUint32(26, true),
    end,
    pcm: bytes.subarray(MIC_HEADER),
  };
}
export function encodeMicrophone(
  epoch: number,
  seq: number,
  capturedAt: number,
  pcm: Uint8Array,
  tag: CaptureTag = { purpose: "social", inputEpoch: 0 },
) {
  if (
    !uint(epoch) ||
    !uint(seq) ||
    !Number.isFinite(capturedAt) ||
    !uint(tag.inputEpoch) ||
    !purposes.includes(tag.purpose) ||
    pcm.length % 2 ||
    pcm.length > 3200 ||
    (!pcm.length && !tag.end && tag.purpose !== "health") ||
    (tag.end && pcm.length)
  )
    throw new Error("Invalid microphone frame");
  const packet = new Uint8Array(MIC_HEADER + pcm.length),
    v = view(packet);
  v.setUint8(0, 1);
  v.setUint32(1, epoch, true);
  v.setUint32(5, seq, true);
  v.setUint32(9, 16000, true);
  v.setUint32(13, pcm.length / 2, true);
  v.setFloat64(17, capturedAt, true);
  v.setUint8(25, purposes.indexOf(tag.purpose));
  v.setUint32(26, tag.inputEpoch, true);
  v.setUint8(30, tag.end ? 1 : 0);
  packet.set(pcm, MIC_HEADER);
  return packet;
}
export function decodeVideo(bytes: Uint8Array) {
  if (bytes.length < 25 || bytes.length > 64000 || ![3, 4].includes(bytes[0]))
    return null;
  const v = view(bytes),
    capturedAt = v.getFloat64(9, true);
  if (
    !Number.isFinite(capturedAt) ||
    bytes[21] !== 0xff ||
    bytes[22] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  )
    return null;
  return {
    epoch: v.getUint32(1, true),
    seq: v.getUint32(5, true),
    capturedAt,
    jpeg: bytes.subarray(21),
    generation: v.getUint32(17, true),
    probe: bytes[0] === 4,
  };
}
export function encodeVideo(
  epoch: number,
  seq: number,
  capturedAt: number,
  jpeg: Uint8Array,
  probe = false,
  generation = 0,
) {
  if (
    !uint(epoch) ||
    !uint(seq) ||
    !Number.isFinite(capturedAt) ||
    !uint(generation) ||
    jpeg.length > 63979
  )
    throw new Error("Invalid video frame");
  const packet = new Uint8Array(21 + jpeg.length),
    v = view(packet);
  v.setUint8(0, probe ? 4 : 3);
  v.setUint32(1, epoch, true);
  v.setUint32(5, seq, true);
  v.setFloat64(9, capturedAt, true);
  v.setUint32(17, generation, true);
  packet.set(jpeg, 21);
  return packet;
}
export const JUDGE_RATE = 44100;
export const JUDGE_FRAME_SAMPLES = 882;
export const JUDGE_MAX_SAMPLES = JUDGE_RATE * 20;
/** Type 2: int16 PCM. Type 5: ordered EOF with final sample count, no payload. */
export function decodeJudgeAudio(bytes: Uint8Array) {
  if (
    bytes.length < 17 ||
    bytes.length > 17 + JUDGE_FRAME_SAMPLES * 2 ||
    ![2, 5].includes(bytes[0])
  )
    return null;
  const v = view(bytes),
    offset = v.getUint32(13, true),
    end = bytes[0] === 5;
  if (
    v.getUint32(9, true) !== JUDGE_RATE ||
    (bytes.length - 17) % 2 ||
    (end ? bytes.length !== 17 : bytes.length === 17) ||
    offset + (bytes.length - 17) / 2 > JUDGE_MAX_SAMPLES
  )
    return null;
  return {
    epoch: v.getUint32(1, true),
    seq: v.getUint32(5, true),
    offset,
    end,
    pcm: new Int16Array(Uint8Array.from(bytes.subarray(17)).buffer),
  };
}
export function encodeJudgeAudio(
  epoch: number,
  seq: number,
  offset: number,
  pcm: Uint8Array,
  end = false,
) {
  if (
    !uint(epoch) ||
    !uint(seq) ||
    !uint(offset) ||
    pcm.length % 2 ||
    pcm.length > JUDGE_FRAME_SAMPLES * 2 ||
    (end ? pcm.length !== 0 : !pcm.length) ||
    offset + pcm.length / 2 > JUDGE_MAX_SAMPLES
  )
    throw new Error("Invalid judge frame");
  const packet = new Uint8Array(17 + pcm.length),
    v = view(packet);
  v.setUint8(0, end ? 5 : 2);
  v.setUint32(1, epoch, true);
  v.setUint32(5, seq, true);
  v.setUint32(9, JUDGE_RATE, true);
  v.setUint32(13, offset, true);
  packet.set(pcm, 17);
  return packet;
}

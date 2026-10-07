import test from "node:test";
import assert from "node:assert/strict";
import { Controller, type Seat } from "../server/controller";
import { canSpeak, scoreShare, type Turn } from "../shared/types";
import { Client } from "../src/client";
function setup() {
  const c = new Controller("1234");
  const a = c.game.addPlayer("Sam"), b = c.game.addPlayer("Alex");
  c.game.state.phase = "ROUND";
  c.game.state.matchId = "match";
  c.game.state.roundId = "round";
  const turn: Turn = { id: "turn", playerId: a.id, kind: "case", durationMs: 30000, remainingMs: 30000, deadline: Date.now()+30000, pausedReason: null, sealing: false, targets: {reasoning:0,rebuttal:0,impact:0,wit:0,clarity:0}, overlapRefundMs:0, suppressOpponent:false };
  c.game.state.turn = turn;
  return {c,a,b,turn};
}
test("exclusive floor policy protects both transports and preserves manual mute", () => {
  const {c,a,b,turn} = setup();
  const client = new Client(); client.state = c.game.state;
  client.session = {playerId:a.id} as any;
  const track = {enabled:true}; client.stream = {getAudioTracks:()=>[track]} as any;
  assert(canSpeak(c.game.state,a.id)); assert(!canSpeak(c.game.state,b.id));
  client.micMuted=true; client.syncMicrophone(); assert(!track.enabled);
  client.micMuted=false;
  turn.playerId=b.id; client.syncMicrophone(); assert(!track.enabled);
  turn.playerId=a.id; client.syncMicrophone(); assert(track.enabled);
  for (const mode of ["rtc", "wss"] as const) {
    c.game.state.mediaMode=mode;
    const pcm: Buffer[] = [], forwarded: Buffer[] = [];
    for (const id of [a.id,b.id]) {
      c.seats.set(id,{audioSeq:-1,lastAudioAt:0,voiceAt:0,lastActivity:0,sockets:new Map()} as Seat);
      c.ink.set(id,{send:(p:Buffer)=>pcm.push(p)} as any);
    }
    c.forward=(_id,_channel,p)=>{forwarded.push(p);};
    const packet=(seq:number)=>{const p=Buffer.alloc(665);p[0]=1;p.writeUInt32LE(c.game.state.mediaEpoch,1);p.writeUInt32LE(seq,5);p.writeUInt32LE(16000,9);p.writeUInt32LE(320,13);p.writeDoubleLE(Date.now(),17);p.writeInt16LE(8000,25);return p;};
    c.audio(b.id,packet(1)); assert(pcm.at(-1)!.every(x=>x===0)); assert.equal(forwarded.length,0);
    c.audio(a.id,packet(1)); assert.equal(pcm.at(-1)!.readInt16LE(0),8000); assert.equal(forwarded.length,mode==="wss"?1:0);
    c.game.state.judge={status:"speaking"} as any;
    c.audio(a.id,packet(2)); assert(pcm.at(-1)!.every(x=>x===0));
    c.game.state.judge=null;
    turn.sealing=true;
    c.sealedAudio.set(a.id,{turnId:turn.id,maxSeq:4,capturedBefore:Date.now(),expiresAt:Date.now()+500});
    c.audio(a.id,packet(3)); assert.equal(pcm.at(-1)!.readInt16LE(0),8000, "captured-before-seal frames drain into the original epoch");
    c.audio(a.id,packet(5)); assert(pcm.at(-1)!.every(x=>x===0));
    turn.sealing=false; c.sealedAudio.clear();
  }
  turn.sealing=true; assert(!canSpeak(c.game.state,a.id)); turn.sealing=false;
  c.game.state.phase="RECOVERING"; assert(!canSpeak(c.game.state,a.id));
  c.game.state.phase="LOBBY"; assert(canSpeak(c.game.state,b.id));
  c.game.state.phase="MATCH_RESULT"; assert(canSpeak(c.game.state,b.id));
});
test("floor is paused before publication and stale completion cannot unlock another turn", () => {
  const {c,a,turn} = setup();
  let published:any;
  c.broadcast=(e)=>{published=e;};
  c.rotate=()=>{};
  c.say=async()=>{};
  c.onEvent({type:"floor_granted",snapshot:c.game.snapshot()} as any);
  assert.equal(published.snapshot.turn.deadline,null);
  assert.equal(turn.pausedReason,"judge");
  const speech={id:"speech",epoch:1,ready:new Set<string>(),duration:0,startedAt:null,done:true,timer:null,maxSeconds:4.5,turnId:"old-turn",matchId:"match"};
  c.speech=speech;c.finishSpeech(speech);
  assert.equal(turn.pausedReason,"judge");
  c.speech={...speech,turnId:turn.id};c.cancelSpeech();
  assert.equal(turn.pausedReason,null);
  assert(canSpeak(c.game.state,a.id));
});
test("relay decode retains delayed frames, coalesces pending work and rejects old epochs", async () => {
  const {c}=setup(); const client=new Client(); client.state=c.game.state;
  const drawn:number[]=[]; let closed=0;
  const savedBitmap=globalThis.createImageBitmap,savedDocument=globalThis.document;
  (globalThis as any).document={createElement:()=>({width:256,height:144,getContext:()=>({drawImage:(b:any)=>drawn.push(b.seq),clearRect:()=>{}})})};
  const frame=(seq:number)=>{const f=new ArrayBuffer(18),v=new DataView(f);v.setUint32(1,client.state!.mediaEpoch,true);v.setUint32(5,seq,true);v.setFloat64(9,Date.now()-5000,true);v.setUint8(17,seq);return f;};
  let release!:()=>void;
  (globalThis as any).createImageBitmap=async(blob:Blob)=>{const seq=new Uint8Array(await blob.arrayBuffer())[0];if(seq===1)await new Promise<void>(r=>{release=r;});return {seq,close:()=>closed++};};
  try {
    client.pendingVideo=frame(1);const decoding=client.decodeVideo();
    while(!release)await new Promise(r=>setImmediate(r));
    client.pendingVideo=frame(2);client.pendingVideo=frame(3);release();await decoding;
    assert.deepEqual(drawn,[1,3]);assert.equal(client.remoteFrameSeq,3);assert(client.remoteFrame);
    client.pendingVideo=frame(4);const old=client.decodeVideo();client.resetVideo();await old;
    assert.deepEqual(drawn,[1,3]);assert.equal(client.remoteFrameSeq,0);assert.equal(closed,3);
  } finally {globalThis.createImageBitmap=savedBitmap;globalThis.document=savedDocument;}
});

test("score display remains safe when a player leaves an unfinished match", () => {
  assert.equal(scoreShare([]), 0.5);
  assert.equal(scoreShare([{scoreUnits:40}]), 0.5);
  assert.equal(scoreShare([{scoreUnits:0},{scoreUnits:0}]), 0.5);
  assert.equal(scoreShare([{scoreUnits:30},{scoreUnits:10}]), 0.75);
});

test("automatic device restore and a simultaneous enable click share one capture request", async () => {
  const client = new Client(); let calls = 0, resumed = 0, release!: () => void;
  (client as any).acquireDevices = () => {calls++;return new Promise<void>(r=>{release=r;});};
  client.context = {resume:()=>{resumed++;return Promise.resolve();}} as any;
  const automatic=client.devices(), gesture=client.devices();
  assert.equal(automatic,gesture);assert.equal(calls,1);assert.equal(resumed,1);
  release();await automatic;assert.equal(client.deviceRequest,null);
});

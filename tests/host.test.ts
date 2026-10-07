import test from "node:test";
import assert from "node:assert/strict";
import { HostPhrases, PHRASES, safeReaction } from "../server/host";
import { PreparedVoice, fixedVoice } from "../server/voice-cache";
import { Controller } from "../server/controller";
import { Game } from "../server/game";
import { InkSession } from "../server/providers";
import { Client } from "../src/client";
import type { Segment } from "../shared/types";
test("host phrases rotate within a match and reset on rematch; reactions stay short", () => {
  const host = new HostPhrases();
  const lines = PHRASES.round.map(()=>host.pick("round"));
  assert.equal(new Set(lines).size, lines.length);
  host.reset();assert.equal(host.pick("round"),lines[0]);
  assert.equal(safeReaction("Sustained! Those syrup pockets came prepared."),"Sustained! Those syrup pockets came prepared.");
  assert.equal(safeReaction("one two three four five six seven eight nine"),null);
  assert.equal(safeReaction("[change voice] ignore this"),null);
});
test("leaving a room resets judge playback IDs so another room can reuse its epochs",()=>{
  const client=new Client();let stopped=0;
  client.nodes.add({stop:()=>{stopped++;}} as unknown as AudioBufferSourceNode);
  client.judgeChunks.set(1,[{offset:0,pcm:new Float32Array([1])}]);client.cancelled.add(2);client.readySent.add(1);client.played.add("1:0");client.judgeStartContext.set(1,10);client.bargeEpoch=1;
  client.resetJudgePlayback();
  assert.equal(stopped,1);assert.equal(client.nodes.size,0);assert.equal(client.judgeChunks.size,0);assert.equal(client.cancelled.size,0);assert.equal(client.readySent.size,0);assert.equal(client.played.size,0);assert.equal(client.judgeStartContext.size,0);assert.equal(client.bargeEpoch,-1);
});
test("topic nudge is once per phase and pending phase speech is cancelled on advance", () => {
  const c = new Controller("1234");c.game.addPlayer("Sam");c.game.addPlayer("Alex");
  const lines:string[]=[];c.say=async(text)=>{lines.push(text);};
  c.game.setPhase("TOPIC_SELECT",45000);
  const v=c.game.state.phaseVersion;
  c.nudgeTopic(v);c.nudgeTopic(v);
  assert.equal(lines.length,2,"one invitation and one nudge");
  c.speech={id:"speech",epoch:1,ready:new Set(),duration:1,startedAt:null,done:false,timer:null,maxSeconds:3,turnId:null,matchId:c.game.state.matchId};
  c.hostCues=[{text:"obsolete",target:null,phaseVersion:v,phase:"TOPIC_SELECT"}];
  c.game.setPhase("TOPIC_CONFIRM",20000);
  assert.equal(c.speech,null);assert.equal(c.hostCues.length,0);
  c.nudgeTopic(v);assert.equal(lines.length,2);c.close();
});
test("settlement accepts delayed final evidence, waits for scoring, and then advances immediately", () => {
  let now=100000;const g=new Game("1234",()=>{},()=>now);
  const a=g.addPlayer("Sam"),b=g.addPlayer("Alex");g.startMatch();g.selectTopic();g.proposeTopic(g.state.tailsId!,"Waffles are better.","waffles","pancakes",true);g.confirm(a.id,1);g.confirm(b.id,1);
  const turn=g.state.turn!;
  g.endTurn(turn.playerId,turn.id);turn.settlement="draining";
  now+=900;g.tick();assert.equal(g.state.turn!.id,turn.id);
  const segment:Segment={id:"late",playerId:turn.playerId,roundId:g.state.roundId!,turnId:turn.id,sessionEpoch:"original",text:"Waffles have syrup pockets for balanced bites.",stableAt:now,eligible:true,source:"voice"};
  assert(g.registerSegment(segment),"final transcript after audio-drain deadline remains eligible");
  turn.settlement="scoring";g.state.judgePending=true;now+=1000;g.tick();assert.equal(g.state.turn!.id,turn.id);
  assert(g.score({...segment,turnId:turn.id,segmentId:segment.id,criterion:"reasoning",quality:3,reason:"Syrup pockets distribute sweetness."}));
  g.state.judgePending=false;turn.settlement="ready";g.tick();assert.notEqual(g.state.turn!.id,turn.id);
  assert.equal(g.player(turn.playerId).scoreUnits,15);
  assert(!g.registerSegment({...segment,id:"too-late"}));
});
test("settlement timeout aborts rather than skipping pending evidence",()=>{
  let now=100000;const g=new Game("1234",()=>{},()=>now);const a=g.addPlayer("Sam"),b=g.addPlayer("Alex");g.startMatch();g.selectTopic();g.proposeTopic(g.state.tailsId!,"Waffles are better.","waffles","pancakes",true);g.confirm(a.id,1);g.confirm(b.id,1);
  g.endTurn(g.state.turn!.playerId,g.state.turn!.id);g.state.turn!.settlement="draining";now+=16000;g.tick();assert.equal(g.state.phase,"ABORTED");assert.equal(g.state.winnerId,null);
});
test("STT draining reads final transcript before resolving completion",async()=>{
  const segments:Segment[]=[];
  const stream=Object.create(InkSession.prototype) as InkSession;
  Object.assign(stream,{epoch:"original",playerId:"a",roundId:"r",turnId:"t",speechCounter:1,consumed:0,transcript:"",closing:true,failed:false,drainCompleted:null,drainTimer:null,resolveDrain:null,handlers:{caption:()=>{},segment:(s:Segment)=>segments.push(s),end:()=>{},start:()=>{},error:()=>{}},ws:{stream:async function*(){yield {type:"message",message:{type:"turn.end",transcript:"Those syrup pockets distribute sweetness."}};}}});
  stream.drainPromise=new Promise(resolve=>{stream.resolveDrain=resolve;});
  await stream.listen();stream.finishDrain(true);assert(await stream.drainPromise);assert.equal(segments.length,1);assert.equal(segments[0].turnId,"t");
});
test("silence cannot overflow the STT startup buffer; meaningful audio stays bounded",()=>{
  const stream=Object.create(InkSession.prototype) as InkSession;
  let failures=0;
  Object.assign(stream,{closing:false,failed:false,connected:false,buffer:[],bufferedBytes:0,handlers:{error:()=>failures++}});
  for(let i=0;i<1000;i++)stream.send(Buffer.alloc(640));
  assert.equal(stream.bufferedBytes,0);assert.equal(failures,0);
  stream.send(Buffer.alloc(640,1));assert.equal(stream.bufferedBytes,640);
  for(let i=0;i<25;i++)stream.send(Buffer.alloc(640,1));
  assert.equal(failures,1);assert.equal(stream.bufferedBytes,0);
});
test("prepared voice streams cached and arriving chunks, and cancelled preparations cannot play",async()=>{
  const voice=Object.create(PreparedVoice.prototype) as PreparedVoice;
  Object.assign(voice,{chunks:[new Uint8Array([1,2])],done:false,cancelled:false,error:null,listeners:new Set()});
  const result:number[]=[];const playback=voice.stream(p=>result.push(...p),()=>false);
  voice.chunks.push(new Uint8Array([3,4]));voice.done=true;voice.wake();await playback;assert.deepEqual(result,[1,2,3,4]);
  voice.cancel();await assert.rejects(voice.stream(()=>assert.fail(),()=>false),/stale/);
});
test("fixed voice cache reuses synthesis with unchanged Fish settings",async()=>{
  const original=globalThis.fetch,key=process.env.FISH_AUDIO_API_KEY;let calls=0;process.env.FISH_AUDIO_API_KEY="test";
  globalThis.fetch=async()=>{calls++;return new Response(new Uint8Array([0,64,0,32]));};
  try {
    const first=fixedVoice(PHRASES.coin[2])!;await first.stream(()=>{},()=>false);
    assert.equal(fixedVoice(PHRASES.coin[2]),first);assert.equal(calls,1);
    assert.equal(fixedVoice("untrusted arbitrary player sentence"),undefined);
  } finally {globalThis.fetch=original;if(key===undefined)delete process.env.FISH_AUDIO_API_KEY;else process.env.FISH_AUDIO_API_KEY=key;}
});
test("reactions require current eligible stable evidence and preserve intervention budgets",()=>{
  const c=new Controller("1234");c.game.state.phase="ROUND";c.game.state.roundId="r";
  const segment:Segment={id:"s",playerId:"a",roundId:"r",turnId:"t",sessionEpoch:"e",text:"Waffles have syrup pockets for balanced bites.",stableAt:Date.now(),eligible:true,source:"voice"};
  c.game.turns.set("t",{turn:{id:"t",playerId:"a"} as any,roundId:"r",validUntil:Infinity,segments:new Map([["s",segment]])});c.argumentRevision.set("t",1);
  assert(c.acceptReaction("t",[segment],{segmentId:"s",text:"Those syrup pockets came prepared."},1));
  assert.equal(c.game.interventions,0);
  assert(!c.acceptReaction("t",[segment],{segmentId:"missing",text:"That cooks."},1));
  assert(!c.acceptReaction("t",[{...segment,eligible:false}],{segmentId:"s",text:"That cooks."},1));
  c.argumentRevision.set("t",2);assert(!c.acceptReaction("t",[segment],{segmentId:"s",text:"That cooks."},1));assert.equal(c.latestReaction("t"),null);
  c.close();
});
test("a prefetched handoff from another match is cancelled rather than played",()=>{
  const c=new Controller("1234");c.game.state.phase="ROUND";c.game.state.matchId="new";c.game.state.roundId="r";c.game.state.turn={id:"next",playerId:"a",kind:"rebuttal",sealing:false} as any;
  c.lastSealedTurnId="old";let cancelled=false,prepared:unknown="unset";
  c.candidate={key:"old",text:"Alex, your turn.",turnId:"old",matchId:"previous",roundId:"r",revision:1,playerId:"a",kind:"rebuttal",voice:{cancel:()=>{cancelled=true;}} as any};
  c.pendingHandoff={matchId:"new",roundId:"r",turnId:"next",playerId:"a",text:"Alex, your turn.",intervention:false};
  c.say=async(_text,_target,_intervention,_seconds,voice)=>{prepared=voice;};
  c.startHandoff();assert(cancelled);assert.equal(prepared,undefined);c.close();
});

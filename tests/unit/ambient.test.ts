import { expect, it } from "vitest";
import { ambientPoses } from "../../src/shared/ambient.ts";
import { AmbientSpeech } from "../../src/shared/ambient-speech.ts";
import { computeScene, type SceneInput } from "../../src/shared/motion.ts";
import { PALETTE } from "../../src/data/palette.ts";
import type { DisplayState } from "../../src/shared/types.ts";
const state: DisplayState = { phase: "idle", phaseStartedAt: 0, phaseEndsAt: null, answeredAt: null, doorOpenedAt: null, sessionId: null, sequenceId: null, previewColorId: null, revision: 1, result: null, questionIndex: null };
const base: SceneInput = { state, now: 10000, width: 1920, height: 1080, displayOrder: 0, reducedMotion: false, colors: PALETTE.colors, resultMode: "animate", previousBackground: null };
it("待機の粒子は小さく薄く、下部に留まり、動きを減らすと静止する", () => {
 const scene = computeScene(base);
 const poses = ambientPoses(1920,1080,10000,state,scene,0,false);
 expect(poses).toHaveLength(180);
 for (const p of poses) { expect(p.y).toBeGreaterThan(740); expect(p.size).toBeLessThan(3); expect(p.alpha).toBeLessThan(.33); expect(p.color).toBe('#ffffff'); }
 expect(ambientPoses(1920,1080,10000,state,scene,0,true)).toEqual(ambientPoses(1920,1080,12000,state,scene,1,true));
 expect(ambientPoses(1920,1080,10000,state,scene,1,false)).not.toEqual(poses);
});
it("リング拡大で退場し、選定中はリングへ合流して消える", () => {
 const scene = computeScene(base);
 const expanded = { ...scene, shards: { ...scene.shards, scale: 2, spread: 1 } };
 expect(ambientPoses(1920,1080,10000,state,expanded,0,false).every(p=>p.x<0 || p.x>1920 || p.y>1080)).toBe(true);
 const judging = { ...state, phase: "judging" as const, phaseStartedAt: 10000 };
 const first = ambientPoses(1920,1080,10000,judging,scene,0,false);
 const merge = ambientPoses(1920,1080,11200,judging,scene,0,false);
 expect(Math.hypot(merge[0].x-960,merge[0].y-540)).toBeLessThan(Math.hypot(first[0].x-960,first[0].y-540));
 expect(ambientPoses(1920,1080,12400,judging,scene,0,false)).toEqual([]);
});
it("発話解析は導入から同期し、余韻とリセットには反応しない", () => {
 const speech = new AmbientSpeech();
 const next = { ...state, phase: "sequence" as const, sessionId: "test", revision: 2 };
 speech.update(state,next,10000);
 expect(Math.max(...Array.from({length:80},(_,i)=>speech.level(10000+i*50)))).toBeGreaterThan(.2);
 expect(speech.level(14500)).toBe(0);
 speech.update(next,{ ...state, revision: 3 },15000);
 expect(speech.level(16000)).toBe(0);
});

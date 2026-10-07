import { describe, it, expect, vi, afterEach } from "vitest";
import { MaintenanceCoordinator } from "./maintenanceCore";
afterEach(() => vi.useRealTimers());
function setup() { let held = false, now = 100; const inspect = vi.fn(async () => [] as string[]), flush = vi.fn(async () => {}); const m = new MaintenanceCoordinator({inspect, flush, hold: v => { held = v; }, now: () => now, token: () => "test-token"}); return { m, inspect, flush, held: () => held, time: (n: number) => { now = n; } }; }
describe("정상 종료의 저장 및 안전 경계", () => {
 it("제작 경계 확인 없이는 상태를 잠그지 않는다", async () => { const s=setup(); await expect(s.m.prepare(false)).rejects.toThrow(); expect(s.held()).toBe(false); expect(s.flush).not.toHaveBeenCalled(); });
 it("실행 작업이 남으면 저장과 종료를 시작하지 않는다", async () => { const s=setup(); s.inspect.mockResolvedValue(["다운로드"]); await expect(s.m.prepare(true)).rejects.toThrow("다운로드"); expect(s.held()).toBe(false); expect(s.flush).not.toHaveBeenCalled(); });
 it("저장 실패가 있으면 토큰을 발급하지 않는다", async () => { const s=setup(); s.flush.mockRejectedValue(Error("저장 실패")); await expect(s.m.prepare(true)).rejects.toThrow("저장 실패"); expect(s.m.status().prepared).toBeNull(); expect(s.held()).toBe(false); });
 it("저장 중에는 새 요청을 막고 저장 완료를 기다린다", async () => { const s=setup(); let done!:()=>void; s.flush.mockImplementation(()=>new Promise<void>(r=>{done=r;})); const p=s.m.prepare(true); await Promise.resolve(); expect(s.held()).toBe(true); await expect(s.m.prepare(true)).rejects.toThrow(); done(); const r=await p; expect(r.token).toBe("test-token"); s.m.abort(); });
 it("저장 직후 발생한 경합도 다시 조회하여 거절한다", async () => { const s=setup(); s.inspect.mockResolvedValueOnce([]).mockResolvedValueOnce(["새 작업"]); await expect(s.m.prepare(true)).rejects.toThrow("새 작업"); expect(s.held()).toBe(false); });
 it("잘못된 토큰은 종료 동작을 호출하지 않는다", async () => { const s=setup(), quit=vi.fn(); await s.m.prepare(true); await expect(s.m.commit("wrong",quit)).rejects.toThrow(); expect(quit).not.toHaveBeenCalled(); expect(s.held()).toBe(false); });
 it("만료된 준비는 종료하지 않는다", async () => { const s=setup(), quit=vi.fn(); const p=await s.m.prepare(true); s.time(p.expiresAt); await expect(s.m.commit(p.token,quit)).rejects.toThrow(); expect(quit).not.toHaveBeenCalled(); });
 it("토큰 기한이 지나면 편집 차단도 자동 해제한다", async () => { vi.useFakeTimers(); const s=setup(); await s.m.prepare(true); vi.advanceTimersByTime(30000); expect(s.held()).toBe(false); expect(s.m.status().prepared).toBeNull(); });
 it("준비 이후 작업이 생기면 종료하지 않는다", async () => { const s=setup(), quit=vi.fn(); const p=await s.m.prepare(true); s.inspect.mockResolvedValue(["실행 중"]); await expect(s.m.commit(p.token,quit)).rejects.toThrow(); expect(quit).not.toHaveBeenCalled(); expect(s.held()).toBe(false); });
 it("정상 경로는 종료 직전에도 저장 성공을 확인한다", async () => { const s=setup(), quit=vi.fn(async()=>{}); const p=await s.m.prepare(true); await s.m.commit(p.token,quit); expect(s.flush).toHaveBeenCalledTimes(2); expect(quit).toHaveBeenCalledTimes(1); expect(s.held()).toBe(true); await expect(s.m.commit(p.token,quit)).rejects.toThrow(); expect(quit).toHaveBeenCalledTimes(1); });
 it("백엔드 거절을 숨기지 않고 편집을 다시 허용한다", async () => { const s=setup(); const p=await s.m.prepare(true); await expect(s.m.commit(p.token,async()=>{throw Error("워커 남음");})).rejects.toThrow("워커 남음"); expect(s.held()).toBe(false); });
 it("준비 취소는 종료 없이 다시 작업을 허용한다", async()=>{const s=setup();await s.m.prepare(true);s.m.abort();expect(s.held()).toBe(false);});
});

it("두 번째 종료 요청은 첫 종료의 편집 차단을 풀지 않는다",async()=>{const s=setup(),p=await s.m.prepare(true);let done!:()=>void;const first=s.m.commit(p.token,()=>new Promise<void>(r=>{done=r;}));for(let n=0;n<8;n++)await Promise.resolve();await expect(s.m.commit(p.token,async()=>{})).rejects.toThrow();expect(s.held()).toBe(true);done();await first;});

it("종료 접수 뒤 새 준비와 취소 요청은 편집 잠금을 풀지 않는다",async()=>{const s=setup(),p=await s.m.prepare(true);await s.m.commit(p.token,async()=>{});await expect(s.m.prepare(true)).rejects.toThrow();expect(()=>s.m.abort()).toThrow();expect(s.held()).toBe(true);s.m.cancelRequestedExit();expect(s.held()).toBe(false);});

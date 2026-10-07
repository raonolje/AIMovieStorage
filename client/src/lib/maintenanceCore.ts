export interface MaintenanceDependencies {
  inspect: () => Promise<string[]>;
  flush: () => Promise<void>;
  hold: (held: boolean) => void;
  now: () => number;
  token: () => string;
  inspectBeforeWorkerRelease?: () => Promise<string[]>;
  releaseIdleWorkers?: () => Promise<void>;
  cancelIdleWorkerRelease?: () => void | Promise<void>;
}
/** 저장 실패와 준비 뒤 경합을 숨기지 않고 앱을 계속 살려 둡니다. */
export class MaintenanceCoordinator {
  private prepared: { token: string; expiresAt: number } | null = null;
  private preparing = false;
  private closing = false;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private cancellationRequested = false;
  private phase: "idle" | "checking" | "saving" | "workers" | "ready" | "closing" = "idle";
  constructor(private deps: MaintenanceDependencies) {}
  status() { return { preparing: this.preparing, closing: this.closing, phase: this.phase, cancellationRequested: this.cancellationRequested, prepared: this.prepared ? { expiresAt: this.prepared.expiresAt } : null }; }
  cancelRequestedExit() { this.closing = false; this.release(); }
  abort() {
    if (this.closing || this.phase === "closing") throw Error("종료 요청이 확인 중입니다.");
    if (this.preparing) {
      this.cancellationRequested = true;
      // 이미 시작한 저장·자연 종료 확인이 끝날 때까지 새 작업 차단을 유지합니다.
      return this.deps.cancelIdleWorkerRelease?.();
    }
    this.release();
  }
  private release() { clearTimeout(this.expiry); this.prepared = null; this.phase = "idle"; this.deps.hold(false); }
  private async requireIdle() { const blockers = await this.deps.inspect(); if (blockers.length) throw Error(blockers.join("; ")); }
  private requireNotCancelled() { if (this.cancellationRequested) throw Error("정상 종료 준비를 취소했습니다. 앱과 남은 워커를 유지합니다."); }
  private async requireBeforeWorkers() {
    const blockers = await (this.deps.inspectBeforeWorkerRelease ?? this.deps.inspect)();
    if (blockers.length) throw Error(blockers.join("; "));
    this.requireNotCancelled();
  }
  async prepare(producerSafeBoundaryConfirmed: boolean) {
    if (!producerSafeBoundaryConfirmed) throw Error("제작 안전 경계를 먼저 확인해 주세요.");
    if (this.closing || this.preparing || this.prepared) throw Error("종료 준비가 이미 진행 중입니다.");
    this.cancellationRequested = false; this.phase = "checking"; this.preparing = true; this.deps.hold(true);
    try {
      await this.requireBeforeWorkers(); this.phase = "saving"; await this.deps.flush(); this.requireNotCancelled();
      if (this.deps.releaseIdleWorkers) {
        await this.requireBeforeWorkers(); this.phase = "workers"; await this.deps.releaseIdleWorkers(); this.requireNotCancelled();
      }
      await this.requireIdle(); this.requireNotCancelled();
      this.prepared = { token: this.deps.token(), expiresAt: this.deps.now() + 30000 };
      this.phase = "ready";
      this.expiry = setTimeout(() => this.release(), 30000);
      return { ...this.prepared };
    } catch (error) { this.release(); throw error; }
    finally { this.preparing = false; }
  }
  async commit(token: string, action: () => Promise<void>) {
    if (this.closing || this.preparing) throw Error("종료 확인이 이미 진행 중입니다.");
    if (!this.prepared || this.prepared.token !== token || this.deps.now() >= this.prepared.expiresAt) {
      this.release(); throw Error("종료 준비가 만료됐거나 일치하지 않습니다.");
    }
    // 토큰은 먼저 소비해 두 번의 종료 요청이 경합하지 않게 합니다.
    this.prepared = null; clearTimeout(this.expiry); this.preparing = true; this.phase = "closing";
    try { await this.requireIdle(); await this.deps.flush(); await this.requireIdle(); this.requireNotCancelled(); await action(); this.closing = true; }
    catch (error) { this.release(); throw error; }
    finally { this.preparing = false; }
  }
}

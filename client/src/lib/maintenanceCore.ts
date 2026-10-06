export interface MaintenanceDependencies {
  inspect: () => Promise<string[]>;
  flush: () => Promise<void>;
  hold: (held: boolean) => void;
  now: () => number;
  token: () => string;
}
/** 저장 실패와 준비 뒤 경합을 숨기지 않고 앱을 계속 살려 둡니다. */
export class MaintenanceCoordinator {
  private prepared: { token: string; expiresAt: number } | null = null;
  private preparing = false;
  private closing = false;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  constructor(private deps: MaintenanceDependencies) {}
  status() { return { preparing: this.preparing, closing: this.closing, prepared: this.prepared ? { expiresAt: this.prepared.expiresAt } : null }; }
  cancelRequestedExit() { this.closing = false; this.release(); }
  abort() { if (this.closing) throw Error("종료 요청이 확인 중입니다."); if (this.preparing) throw Error("저장 확인 중에는 준비를 취소할 수 없습니다."); this.release(); }
  private release() { clearTimeout(this.expiry); this.prepared = null; this.deps.hold(false); }
  private async requireIdle() { const blockers = await this.deps.inspect(); if (blockers.length) throw Error(blockers.join("; ")); }
  async prepare(producerSafeBoundaryConfirmed: boolean) {
    if (!producerSafeBoundaryConfirmed) throw Error("제작 안전 경계를 먼저 확인해 주세요.");
    if (this.closing || this.preparing || this.prepared) throw Error("종료 준비가 이미 진행 중입니다.");
    this.preparing = true; this.deps.hold(true);
    try {
      await this.requireIdle(); await this.deps.flush(); await this.requireIdle();
      this.prepared = { token: this.deps.token(), expiresAt: this.deps.now() + 30000 };
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
    this.prepared = null; clearTimeout(this.expiry); this.preparing = true;
    try { await this.requireIdle(); await this.deps.flush(); await this.requireIdle(); await action(); this.closing = true; }
    catch (error) { this.release(); throw error; }
    finally { this.preparing = false; }
  }
}

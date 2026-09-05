export interface StageTiming {
  name: string;
  startedAt: number;
  durationMs: number;
}

export class Telemetry {
  private readonly marks = new Map<string, number>();
  private readonly stages: StageTiming[] = [];

  start(name: string): void {
    this.marks.set(name, performance.now());
  }

  end(name: string): void {
    const startedAt = this.marks.get(name);
    if (startedAt === undefined) return;
    this.stages.push({ name, startedAt, durationMs: performance.now() - startedAt });
  }

  getStages(): StageTiming[] {
    return [...this.stages];
  }

  totalMs(): number {
    if (this.stages.length === 0) return 0;
    const first = Math.min(...this.stages.map((stage) => stage.startedAt));
    const last = this.stages.reduce((acc, stage) => Math.max(acc, stage.startedAt + stage.durationMs), 0);
    return last - first;
  }

  toJSON(): Record<string, number> {
    return this.stages.reduce<Record<string, number>>((acc, stage) => {
      acc[stage.name] = Number(stage.durationMs.toFixed(2));
      return acc;
    }, { totalMs: Number(this.totalMs().toFixed(2)) });
  }
}
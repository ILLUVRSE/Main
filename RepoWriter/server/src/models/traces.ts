export interface Trace {
  id: string;
  nodes: string[];
  edges: string[];
}

export class TraceModel {
  private traces: Trace[] = [];

  public createTrace(trace: Trace): void {
    this.traces.push(trace);
  }

  public getTraces(): Trace[] {
    return this.traces;
  }
}
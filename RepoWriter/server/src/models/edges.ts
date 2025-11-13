export interface Edge {
  source: string;
  target: string;
}

export class EdgeModel {
  private edges: Edge[] = [];

  public createEdge(edge: Edge): void {
    this.edges.push(edge);
  }

  public getEdges(): Edge[] {
    return this.edges;
  }
}
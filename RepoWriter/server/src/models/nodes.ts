export interface Node {
  id: string;
  data: any;
}

export class NodeModel {
  private nodes: Node[] = [];

  public createNode(node: Node): void {
    this.nodes.push(node);
  }

  public getNodes(): Node[] {
    return this.nodes;
  }
}
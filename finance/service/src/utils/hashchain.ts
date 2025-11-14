import crypto from 'crypto';

export interface HashLink {
  chunk: number;
  range: { start: number; end: number };
  hash: string;
  prev?: string;
}

export function buildHashChain(items: string[], chunkSize = 500): HashLink[] {
  const links: HashLink[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunkItems = items.slice(i, i + chunkSize);
    const hash = crypto.createHash('sha256').update(chunkItems.join('\n')).digest('hex');
    const prev = links.length ? links[links.length - 1].hash : undefined;
    links.push({
      chunk: links.length,
      range: { start: i, end: i + chunkItems.length - 1 },
      hash,
      prev,
    });
  }
  return links;
}

export function verifyHashChain(items: string[], chain: HashLink[], chunkSize = 500): boolean {
  const rebuilt = buildHashChain(items, chunkSize);
  return JSON.stringify(rebuilt) === JSON.stringify(chain);
}

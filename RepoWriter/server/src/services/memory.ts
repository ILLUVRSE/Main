import fs from "fs/promises";
import path from "path";
const dataDir = path.resolve("server", "data");
const file = path.join(dataDir, "memory.json");

async function ensure() { await fs.mkdir(dataDir, { recursive: true }); }

export async function getMemory() {
  await ensure();
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch { return { notes: [] as string[] }; }
}

export async function setMemory(obj: any) {
  await ensure();
  await fs.writeFile(file, JSON.stringify(obj, null, 2), "utf8");
  return { ok: true };
}

export async function appendMemory({ note }: { note: string }) {
  const m = await getMemory();
  m.notes.push(note);
  await setMemory(m);
  return { ok: true };
}


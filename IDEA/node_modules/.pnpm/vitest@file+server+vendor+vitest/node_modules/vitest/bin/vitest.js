#!/usr/bin/env node
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import process from 'process';
import { initialize } from 'tsx/esm';
import '../index.js';
import { __run } from '../index.js';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

function isTestFile(file) {
  return file.endsWith('.test.ts') || file.endsWith('.test.js') || file.endsWith('.spec.ts') || file.endsWith('.spec.js');
}

async function collect(dir) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await collect(full)));
      } else if (isTestFile(entry.name)) {
        results.push(full);
      }
    }
  } catch (err) {
    if ((err && err.code) !== 'ENOENT') {
      throw err;
    }
  }
  return results;
}

async function resolveTestFiles(cwd, patterns) {
  if (patterns.length > 0) {
    return patterns.map((p) => path.resolve(cwd, p));
  }
  const defaults = [];
  defaults.push(...(await collect(path.join(cwd, 'test'))));
  defaults.push(...(await collect(path.join(cwd, 'tests'))));
  const rootFiles = await fs.readdir(cwd).catch(() => []);
  for (const file of rootFiles) {
    if (isTestFile(file)) {
      defaults.push(path.join(cwd, file));
    }
  }
  return defaults;
}

(async () => {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const cwd = process.cwd();
  const files = await resolveTestFiles(cwd, args);

  if (files.length === 0) {
    console.log('No tests found.');
    process.exit(0);
  }

  await initialize({ transpileOnly: true });

  for (const file of files) {
    await import(pathToFileURL(file).href);
  }

  const ok = await __run();
  process.exit(ok ? 0 : 1);
})();

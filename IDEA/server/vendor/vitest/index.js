const createSuite = (name, parent = null) => ({
  name,
  parent,
  items: [],
  beforeAll: [],
  afterAll: [],
  beforeEach: [],
  afterEach: []
});

const state = globalThis.__vitestState || (() => {
  const root = createSuite('root');
  const data = {
    root,
    current: root,
    stack: [root],
    results: []
  };
  globalThis.__vitestState = data;
  return data;
})();

function pushSuite(name, fn) {
  const parent = state.stack[state.stack.length - 1];
  const suite = createSuite(name, parent);
  parent.items.push({ kind: 'suite', value: suite });
  state.stack.push(suite);
  try {
    fn();
  } finally {
    state.stack.pop();
  }
}

export function describe(name, fn) {
  pushSuite(name, fn);
}

export const it = (name, fn) => {
  const suite = state.stack[state.stack.length - 1];
  suite.items.push({ kind: 'test', name, fn });
};

export const test = it;

export function beforeAll(fn) {
  const suite = state.stack[state.stack.length - 1];
  suite.beforeAll.push(fn);
}

export function afterAll(fn) {
  const suite = state.stack[state.stack.length - 1];
  suite.afterAll.push(fn);
}

export function beforeEach(fn) {
  const suite = state.stack[state.stack.length - 1];
  suite.beforeEach.push(fn);
}

export function afterEach(fn) {
  const suite = state.stack[state.stack.length - 1];
  suite.afterEach.push(fn);
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function deepEqual(a, b) {
  if (Object.is(a, b)) {
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isObject(a) && isObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function formatValue(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function expect(received) {
  return {
    toBe(expected) {
      if (!Object.is(received, expected)) {
        throw new Error(`Expected ${formatValue(received)} to be ${formatValue(expected)}`);
      }
    },
    toEqual(expected) {
      if (!deepEqual(received, expected)) {
        throw new Error(`Expected ${formatValue(received)} to equal ${formatValue(expected)}`);
      }
    },
    toHaveLength(length) {
      if (!received || typeof received.length !== 'number' || received.length !== length) {
        throw new Error(`Expected value to have length ${length}, received ${formatValue(received)}`);
      }
    }
  };
}

function collectBeforeEach(chain) {
  const hooks = [];
  for (const suite of chain) {
    for (const hook of suite.beforeEach) {
      hooks.push(hook);
    }
  }
  return hooks;
}

function collectAfterEach(chain) {
  const hooks = [];
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const suite = chain[i];
    for (const hook of suite.afterEach) {
      hooks.push(hook);
    }
  }
  return hooks;
}

async function runHooks(hooks) {
  for (const hook of hooks) {
    await hook();
  }
}

async function runTest(chain, test) {
  await runHooks(collectBeforeEach(chain));
  await test.fn();
  await runHooks(collectAfterEach(chain));
}

async function runSuite(suite, chain = []) {
  const currentChain = [...chain, suite];
  for (const hook of suite.beforeAll) {
    await hook();
  }

  for (const item of suite.items) {
    if (item.kind === 'suite') {
      await runSuite(item.value, currentChain);
    } else {
      try {
        await runTest(currentChain, item);
        state.results.push({ name: [...currentChain.slice(1).map((s) => s.name), item.name].join(' > '), status: 'passed' });
        console.log(`✓ ${item.name}`);
      } catch (err) {
        state.results.push({
          name: [...currentChain.slice(1).map((s) => s.name), item.name].join(' > '),
          status: 'failed',
          error: err
        });
        console.error(`✗ ${item.name}`);
        if (err && err.stack) {
          console.error(err.stack);
        } else {
          console.error(err);
        }
      }
    }
  }

  for (const hook of suite.afterAll) {
    await hook();
  }
}

export async function __run() {
  state.results = [];
  await runSuite(state.root, []);
  const failed = state.results.filter((r) => r.status === 'failed').length;
  const passed = state.results.filter((r) => r.status === 'passed').length;
  console.log(`\n${passed} passed, ${failed} failed`);
  return failed === 0;
}

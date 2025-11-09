export type TestFunction = () => void | Promise<void>;
export type HookFunction = () => void | Promise<void>;

export function describe(name: string, fn: () => void): void;
export function it(name: string, fn: TestFunction): void;
export function test(name: string, fn: TestFunction): void;
export function beforeAll(fn: HookFunction): void;
export function afterAll(fn: HookFunction): void;
export function beforeEach(fn: HookFunction): void;
export function afterEach(fn: HookFunction): void;

export interface Expectation {
  toBe(value: unknown): void;
  toEqual(value: unknown): void;
  toHaveLength(length: number): void;
}

export function expect(actual: unknown): Expectation;

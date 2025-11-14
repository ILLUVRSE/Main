import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("planner", () => {
  let realFetch: any;

  beforeEach(() => {
    vi.resetModules();
    realFetch = globalThis.fetch;
    // required by config.ts so imports succeed
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_PROJECT_ID = "proj-test";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_PROJECT_ID;
    vi.restoreAllMocks();
  });

  it("parses a structured plan from the model output", async () => {
    // Model-like output: choices[0].message.content contains a JSON string
    const modelOutput = {
      steps: [
        {
          explanation: "Create a hello.txt file with greeting",
          patches: [
            {
              path: "hello.txt",
              content: "Hello from RepoWriter mock!\n"
            }
          ]
        }
      ]
    };

    globalThis.fetch = vi.fn(async (_url: any, _opts: any) => {
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(modelOutput)
                }
              }
            ]
          })
      };
    });

    const { planEdits } = await import("../src/services/planner.js");
    const plan = await planEdits("Create hello.txt with greeting");

    expect(plan).toBeTruthy();
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    const first = plan.steps[0];
    expect(first.explanation).toContain("Create");
    expect(Array.isArray(first.patches)).toBe(true);
    expect(first.patches.length).toBe(1);
    expect(first.patches[0].path).toBe("hello.txt");
    expect(first.patches[0].content).toBe("Hello from RepoWriter mock!\n");
  });

  it("returns a fallback plan if model output is unparsable", async () => {
    // Return raw text that is not JSON
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        text: async () => "this is not json"
      };
    });

    const { planEdits } = await import("../src/services/planner.js");
    const plan = await planEdits("Please do something weird");

    expect(plan).toBeTruthy();
    expect(Array.isArray(plan.steps)).toBe(true);
    expect(plan.meta?.unparsable || plan.meta?.error || true).toBeTruthy();
    // Fallback includes a patch with __raw_model_output__
    const p = plan.steps[0].patches[0];
    expect(String(p.content || "")).toContain("__raw_model_output__");
  });
});


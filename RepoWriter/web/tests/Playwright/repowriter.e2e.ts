import { test, expect } from "@playwright/test";
import { spawn, ChildProcess } from "child_process";

const MOCK_PATH = "RepoWriter/test/openaiMock.js";
const MOCK_PORT = 9876;
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const SERVER_HEALTH = process.env.SERVER_HEALTH ?? "http://localhost:7071/api/health";

test.describe("RepoWriter E2E smoke (plan -> dry -> apply -> rollback)", () => {
  let mockProc: ChildProcess | null = null;

  test.beforeAll(async () => {
    // Ensure OpenAI mock is running (start it if not)
    try {
      // Try direct health check first
      const r = await fetch(`http://127.0.0.1:${MOCK_PORT}/health`).catch(() => null);
      if (!r || !r.ok) {
        mockProc = spawn("node", [MOCK_PATH], {
          stdio: "ignore",
          detached: true,
        });
        // allow it a short time to start
        await new Promise((res) => setTimeout(res, 300));
      }
    } catch {
      // best-effort; if spawn fails tests may still proceed if mock is externally available
      // swallow
    }

    // Wait for server health
    const max = 20;
    let ok = false;
    for (let i = 0; i < max; i++) {
      try {
        const r = await fetch(SERVER_HEALTH);
        if (r && r.ok) {
          const j = await r.json().catch(() => null);
          if (j && j.ok) {
            ok = true;
            break;
          }
        }
      } catch {
        // ignore
      }
      await new Promise((res) => setTimeout(res, 500));
    }

    if (!ok) {
      throw new Error(`Server at ${SERVER_HEALTH} did not become healthy in time.`);
    }
  });

  test.afterAll(async () => {
    // Kill the mock if we started it
    try {
      if (mockProc && mockProc.pid) {
        process.kill(-mockProc.pid, "SIGTERM"); // kill group
      }
    } catch {
      // ignore
    }
  });

  test("plan -> dry-run -> apply -> rollback", async ({ page }) => {
    // Navigate to the app
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

    // Wait for app to be ready by checking presence of a textarea prompt
    const promptTextarea = page.locator("textarea").first();
    await expect(promptTextarea).toBeVisible({ timeout: 5000 });

    const PROMPT = 'Create a file hello.txt with the text: "Hello from RepoWriter mock!"';

    // Fill prompt and trigger planning
    await promptTextarea.fill(PROMPT);

    // Click Plan button (tries to find by role with name containing "Plan")
    const planButton = page.getByRole("button", { name: /Plan/i });
    await expect(planButton).toBeVisible({ timeout: 2000 });
    await planButton.click();

    // Wait for the plan to show the hello.txt patch (should appear in Plan Preview)
    await expect(page.locator("text=hello.txt")).toBeVisible({ timeout: 5000 });

    // Run dry-run via UI button (Dry run selected)
    const dryRunButton = page.getByRole("button", { name: /Dry run|Dry-run|Dry-run selected/i });
    await expect(dryRunButton).toBeVisible({ timeout: 2000 });
    await dryRunButton.click();

    // Expect the UI status to show Dry-run succeeded or apply result to contain mode "dry"
    await expect(page.locator("text=Dry-run succeeded")).toBeVisible({ timeout: 5000 });

    // Now apply selected
    // The apply button in the CodeAssistant is "Apply selected" or could be "Apply"
    const applyButton = page.getByRole("button", { name: /Apply/i }).first();
    await expect(applyButton).toBeVisible({ timeout: 2000 });
    await applyButton.click();

    // Wait for UI to report apply succeeded
    await expect(page.locator("text=Apply succeeded")).toBeVisible({ timeout: 10000 });

    // Confirm a commit exists in history via the server API
    const histResp = await fetch("http://localhost:7071/api/history");
    expect(histResp.ok).toBeTruthy();
    const histJson = await histResp.json();
    expect(Array.isArray(histJson.commits)).toBeTruthy();
    const commits = histJson.commits as any[];
    expect(commits.length).toBeGreaterThan(0);

    // The most recent repowriter commit should be present
    const latest = commits[0];
    expect(latest.message).toMatch(/repowriter:/i);

    const sha = latest.sha;
    test.info().attachments?.push?.({
      name: "commit-sha",
      body: sha,
    });

    // Request rollback through API
    const rbResp = await fetch("http://localhost:7071/api/history/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commitSha: sha }),
    });

    expect(rbResp.ok).toBeTruthy();
    const rbJson = await rbResp.json();
    expect(rbJson.ok).toBeTruthy();

    // Confirm the commit is no longer at HEAD (optional check)
    const newHist = await (await fetch("http://localhost:7071/api/history")).json();
    const stillHas = (newHist.commits || []).some((c: any) => c.sha === sha);
    expect(stillHas).toBeFalsy();
  }, 60_000); // timeout for the test
});


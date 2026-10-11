import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { resolve } from "node:path";
import type axe from "axe-core";

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
});

async function accessible(page: Page) {
  await page.addScriptTag({ path: resolve("node_modules/axe-core/axe.min.js") });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: typeof axe }).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    return result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target),
    }));
  });
  expect(violations).toEqual([]);
}

async function session(
  request: APIRequestContext,
  participantId = "p-001",
  mode = "mock",
  protocolId = "mock-autoinjector",
) {
  const response = await request.post("/api/coordinator/sessions", {
    data: { participantId, protocolId, mode },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as { sessionId: string; link: string };
}

async function startScript(page: Page, link: string, scenario: string) {
  await page.goto(`${link}?scenario=${scenario}`);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByRole("button", { name: "Continue with simulated checks" }).click();
  await page.getByRole("button", { name: "Start my procedure" }).click();
}

test("launcher is accessible in light/dark at a narrow viewport and supports keyboard navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/demo");
  await expect(page.getByRole("combobox", { name: "Procedure", exact: true })).toHaveValue(
    "hands-only",
  );
  await expect(
    page.getByRole("combobox", { name: "Scripted scenario", exact: false }),
  ).not.toBeVisible();
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await accessible(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.getByRole("combobox", { name: "Procedure", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Participant", exact: true })).toBeFocused();
});

test("default launcher creates a live hands-only session without selecting an outcome", async ({
  page,
}) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Start live camera demo" }).click();
  await expect(page.getByText("Hands-only camera demo", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue with simulated checks" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Allow camera/ })).toBeVisible();
});

for (const scenario of ["happy", "skip-critical"]) {
  test(`hands-only engine and coordinator pipeline (${scenario}, simulated recognition)`, async ({
    page,
    request,
  }) => {
    const created = await session(request, "p-001", "mock", "hands-only");
    await startScript(page, created.link, scenario);
    if (scenario === "happy") {
      await expect(page.getByRole("heading", { name: "All done", exact: true })).toBeVisible({
        timeout: 30_000,
      });
    } else {
      await expect(
        page.getByRole("heading").filter({ hasText: "Stop. Call your study nurse" }),
      ).toBeVisible();
    }
    await page.goto(`/coordinator/sessions/${created.sessionId}`);
    await expect(page.getByRole("link", { name: /Open evidence frame/ }).first()).toBeVisible();
    if (scenario === "happy") {
      await expect(page.getByText("All steps confirmed.", { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText("critical miss · Study team", { exact: true })).toBeVisible();
    }
  });
}

for (const participantId of ["p-001", "p-002"]) {
  test(`critical stop persists evidence and honors contact consent (${participantId})`, async ({
    page,
    request,
  }) => {
    const created = await session(request, participantId);
    await startScript(page, created.link, "skip-critical");
    await page.getByRole("heading", { name: "Read the pen label aloud", exact: true }).waitFor();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("heading", { name: "Check the expiry date", exact: true }).waitFor();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("heading").filter({ hasText: "Stop. Call your study nurse" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await accessible(page);
    await page.goto(`/coordinator/sessions/${created.sessionId}`);
    const alerts = page.getByRole("region", { name: "Escalation alerts" });
    await expect(alerts.getByRole("listitem")).toHaveCount(participantId === "p-001" ? 2 : 1);
    await expect(alerts.getByText(/Simulated delivery/)).toHaveCount(
      participantId === "p-001" ? 2 : 1,
    );
    await expect(page.getByRole("link", { name: /Open evidence frame/ }).first()).toBeVisible();
    await alerts.getByRole("button", { name: "Review alert" }).first().click();
    await expect(alerts.getByText("Reviewed", { exact: true })).toHaveCount(1);
    await accessible(page);
  });
}

test("no response records a timeout alert and a used session cannot restart on reload", async ({
  page,
  request,
}) => {
  const created = await session(request);
  await startScript(page, created.link, "no-response");
  await expect(
    page.getByRole("heading").filter({ hasText: "Stop. Call your study nurse" }),
  ).toBeVisible({ timeout: 25_000 });
  await page.goto(`/coordinator/sessions/${created.sessionId}`);
  await expect(page.getByText("no response · Study team", { exact: true })).toBeVisible();
  const another = await session(request);
  await startScript(page, another.link, "happy");
  await page.getByRole("heading", { name: "Read the pen label aloud", exact: true }).waitFor();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "This session has already started" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
});

test("recorded video follows the patient pipeline and persists evidence", async ({
  page,
  request,
}) => {
  const protocolId = `replay-test-${Date.now()}`;
  const saved = await request.post("/api/protocols", {
    data: {
      protocol: {
        id: protocolId,
        title: "Synthetic replay check",
        isDemo: true,
        steps: [
          {
            id: "test-pattern",
            order: 1,
            instruction: "Show the test pattern",
            spokenPrompt: "Keep the test pattern visible for two seconds.",
            successCriteria: "A synthetic moving pattern is visible.",
            critical: true,
            verification: "visual",
            timerSeconds: 2,
          },
        ],
      },
    },
  });
  expect(saved.ok()).toBe(true);
  expect(
    (await request.post(`/api/protocols/${protocolId}/publish`, { data: { version: 1 } })).ok(),
  ).toBe(true);
  const created = await session(request, "p-001", "replay", protocolId);
  await page.goto(created.link);
  // Create a local synthetic recording: no person, camera, network media, or API quota.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;
    const stream = canvas.captureStream(10);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    const parts: Blob[] = [];
    recorder.ondataavailable = (e) => parts.push(e.data);
    const done = new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(parts, { type: "video/webm" }));
    });
    let n = 0;
    const timer = setInterval(() => {
      ctx.fillStyle = n++ % 2 ? "#0b4fd6" : "#116b2f";
      ctx.fillRect(0, 0, 320, 240);
    }, 100);
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    recorder.stop();
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    return Array.from(new Uint8Array(await (await done).arrayBuffer()));
  });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page
    .getByLabel("Video recording", { exact: true })
    .setInputFiles({ name: "synthetic.webm", mimeType: "video/webm", buffer: Buffer.from(bytes) });
  await accessible(page);
  await page.getByRole("button", { name: "Start replay", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All done", exact: true })).toBeVisible();
  await page.goto(`/coordinator/sessions/${created.sessionId}`);
  await expect(page.getByText("All steps confirmed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open evidence frame/ }).first()).toBeVisible();
});

test("phone-sized happy demo supports pause, repeat, resume and completes with a coordinator record", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const created = await session(request);
  await startScript(page, created.link, "happy");
  await page.getByRole("heading", { name: "Read the pen label aloud", exact: true }).waitFor();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Repeat", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("heading", { name: "Check the expiry date", exact: true }).waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All done", exact: true })).toBeVisible({
    timeout: 60_000,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await accessible(page);
  await page.goto(`/coordinator/sessions/${created.sessionId}`);
  await expect(page.getByText("All steps confirmed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open evidence frame/ }).first()).toBeVisible();
});

test("vision outage pauses then stops and records study-team escalation", async ({
  page,
  request,
}) => {
  const created = await session(request);
  await startScript(page, created.link, "outage");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    page.getByRole("heading").filter({ hasText: "Stop. Call your study nurse" }),
  ).toBeVisible({ timeout: 40_000 });
  await page.goto(`/coordinator/sessions/${created.sessionId}`);
  await expect(page.getByText("needs human · Study team", { exact: true })).toBeVisible();
});

test.describe("live preview and checking recovery (fake camera, mock recognition)", () => {
  test("keeps a large full-frame preview through ready, pause, and verified recovery", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/demo");
    await page.getByRole("button", { name: "Start live camera demo" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Allow camera and microphone", exact: true }).click();
    await page.getByRole("button", { name: "Start my procedure" }).waitFor();
    const camera = page.getByLabel("Your camera", { exact: true });
    await expect(camera).toBeVisible();
    const box = await camera.boundingBox();
    expect(box!.width).toBeGreaterThan(580);
    expect(box!.height).toBeGreaterThan(350);
    expect(await camera.evaluate((el) => getComputedStyle(el).objectFit)).toBe("contain");
    let failed = true;
    await page.route("**/api/vision/check", async (route) => {
      if (failed)
        await route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ error: "network" }),
        });
      else await route.continue();
    });
    await page.getByRole("button", { name: "Start my procedure" }).click();
    await expect(page.getByRole("heading", { name: "Paused", exact: true })).toBeVisible();
    await expect(camera).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await expect(
      page.getByText("This pause is a checking problem; it does not mean you made a mistake."),
    ).toBeVisible();
    await accessible(page);
    await page.screenshot({
      path: "eval/readiness-videos/large-camera-checking-pause.png",
      fullPage: true,
    });
    failed = false;
    await expect(
      page.getByText("Camera checks are working again. Tap Continue when you're ready."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const instruction = page.getByRole("heading", {
      name: "Show both open hands to the camera",
      exact: true,
    });
    await expect(instruction).toBeVisible();
    for (const width of [1280, 900, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const cameraBox = (await camera.boundingBox())!;
      const instructionBox = (await instruction.boundingBox())!;
      expect(instructionBox.x).toBeGreaterThan(cameraBox.x + cameraBox.width);
      expect(instructionBox.y).toBeLessThan(cameraBox.y + cameraBox.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      if (width === 1280)
        await page.screenshot({
          path: "eval/readiness-videos/camera-beside-instructions.png",
          fullPage: true,
        });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(camera).toBeVisible();
    const mobileCamera = (await camera.boundingBox())!;
    expect((await instruction.boundingBox())!.y).toBeGreaterThanOrEqual(
      mobileCamera.y + mobileCamera.height,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});

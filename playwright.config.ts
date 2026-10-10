import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 2,
  use: {
    baseURL: "http://127.0.0.1:3107",
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start -- --port 3107",
    url: "http://127.0.0.1:3107/demo",
    reuseExistingServer: false,
    env: {
      PERSISTENCE: "memory",
      VISION_PROVIDER: "mock",
      PROTOCOL_COMPILER: "mock",
      NOTIFIER: "mock",
      NEXT_PUBLIC_VOICE_PROVIDER: "browser",
      COORDINATOR_PASSCODE: "",
    },
  },
});

// Tests run the real app in Chromium at a tablet size, with touch and a pretend microphone.
import { defineConfig } from '@playwright/test';

const PORT = 8137;

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
    serviceWorkers: 'block',            // every test loads the files as they are on disk
    acceptDownloads: true,
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: `node tests/server.mjs ${PORT}`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});

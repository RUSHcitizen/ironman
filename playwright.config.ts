import { defineConfig, devices } from "@playwright/test";

// Runs the production build through `vite preview`. WebGL in headless Chromium
// uses SwiftShader (software rendering), so FPS numbers here are NOT
// representative of real devices.
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    launchOptions: { args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    command: "npm run build && npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } } },
    {
      name: "mobile-landscape-emulated",
      use: {
        ...devices["iPhone 13 landscape"],
        // Chromium engine with iPhone viewport/touch emulation - NOT real Safari.
        browserName: "chromium",
        defaultBrowserType: "chromium",
      },
    },
  ],
});

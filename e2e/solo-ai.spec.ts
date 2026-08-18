import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

/** A tiny untrained-but-structurally-valid `TichuPolicyValueNet` export (see
 * `ai/tests/test_export_onnx.py` for the same pattern) -- committed as a fixture
 * instead of depending on `packages/client/public/models/`'s real deployed model,
 * which is a gitignored build artifact that only exists once Task 1's checkpoint
 * placement step has actually run (see `packages/client/public/models/README.md`).
 * Inference quality is irrelevant here; only "loads and produces legal-shaped
 * output" matters for this test. */
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const MODEL_BYTES = readFileSync(path.join(FIXTURES_DIR, 'policy.onnx.enc'));
const MANIFEST_BYTES = readFileSync(path.join(FIXTURES_DIR, 'manifest.json'));

async function mockModelAssets(page: Page): Promise<void> {
  await page.route('**/models/manifest.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: MANIFEST_BYTES }),
  );
  await page.route('**/models/policy.onnx.enc', (route) =>
    route.fulfill({ status: 200, contentType: 'application/octet-stream', body: MODEL_BYTES }),
  );
}

async function enterSoloAiPractice(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'AI와 연습하기', exact: true }).click();
  await page.getByRole('heading', { name: '그랜드 티츄' }).waitFor({ timeout: 30_000 });
}

test('loads the AI model online, then reuses the cached copy fully offline', async ({ page, context }) => {
  test.setTimeout(60_000);

  await mockModelAssets(page);
  await page.goto('/');

  await enterSoloAiPractice(page);
  await page.getByRole('button', { name: '나가기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '티츄', exact: true })).toBeVisible();

  // Stop mocking and go genuinely offline -- the second load must succeed purely
  // from Cache Storage (populated by the first load above), proving `loadModel`'s
  // offline fallback (`packages/client/src/ai/loadModel.ts`) actually works rather
  // than relying on the mocked route.
  await page.unroute('**/models/manifest.json');
  await page.unroute('**/models/policy.onnx.enc');
  await context.setOffline(true);

  await enterSoloAiPractice(page);
  await expect(page.getByRole('alert')).not.toBeVisible();
});

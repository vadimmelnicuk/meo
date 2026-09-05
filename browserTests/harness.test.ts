import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { startBrowserHarness, type BrowserHarness } from './harness';

let harness: BrowserHarness;

beforeAll(async () => {
  harness = await startBrowserHarness();
});

afterAll(async () => {
  await harness?.close();
});

describe('browser test harness', () => {
  it('boots an editor in Live mode', async () => {
    const page = await harness.openLiveEditor('# Harness\n\nBody text.\n');

    const content = await page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? '');
    expect(content).toContain('Harness');

    const postedTypes = await page.evaluate(() =>
      (window as any).__postedMessages.map((message: any) => message.type)
    );
    expect(postedTypes.length).toBeGreaterThan(0);

    await page.close();
  });
});

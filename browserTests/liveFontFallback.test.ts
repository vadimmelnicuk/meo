import {
  describe, describe as context, it,
  beforeAll, afterAll, beforeEach, afterEach,
  expect,
} from 'bun:test';
import type { Page } from 'puppeteer';
import { startBrowserHarness, type BrowserHarness } from './harness';

const doc = '# Heading\n\nBody text for font inspection.\n';

function contentFontFamily(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.querySelector('.cm-content')!).fontFamily);
}

let harness: BrowserHarness;
beforeAll(async () => {
  harness = await startBrowserHarness();
});
afterAll(async () => {
  await harness?.close();
});

describe('MEO', () => {

  context('given a valid `markdown.preview.fontFamily` config', () => {
    let page: Page;
    beforeEach(async () => {
      page = await harness.openLiveEditor(doc, { vscodePreviewFontFamily: 'Georgia' });
    });
    afterEach(async () => {
      await page.close();
    });

    it('uses that font family for Live mode', async () => {
      expect(await contentFontFamily(page)).toContain('Georgia');
    });

    it('does not use that font family for Source mode', async () => {
      await page.evaluate(() => {
        window.postMessage({ type: 'toggleMode' }, '*');
      });
      await page.waitForSelector('.cm-editor.meo-mode-source');
      expect(await contentFontFamily(page)).not.toContain('Georgia');
    });
  });

  context('absent a `markdown.preview.fontFamily` config', () => {
    let page: Page;
    beforeEach(async () => {
      page = await harness.openLiveEditor(doc);
    });
    afterEach(async () => {
      await page.close();
    });

    it('uses the preview default for Live mode', async () => {
      expect(await contentFontFamily(page)).toContain('Segoe WPC');
    });

    it('does not use the preview default for Source mode', async () => {
      await page.evaluate(() => {
        window.postMessage({ type: 'toggleMode' }, '*');
      });
      await page.waitForSelector('.cm-editor.meo-mode-source');
      expect(await contentFontFamily(page)).not.toContain('Segoe WPC');
    });
  });

});

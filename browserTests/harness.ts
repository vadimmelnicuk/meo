import { join } from 'node:path';
import puppeteer, { type Page } from 'puppeteer';

const distDir = join(import.meta.dir, '../webview/dist');
const harnessPath = join(import.meta.dir, 'harness.html');

export interface BrowserHarness {
  /**
   * @param doc        Initial document text
   * @param initExtras Test-specific properties for the initial ExtensionMessage (`type: 'init'`)
   */
  openLiveEditor(doc: string, initExtras?: Record<string, unknown>): Promise<Page>;

  close(): Promise<void>;
}

export async function startBrowserHarness(): Promise<BrowserHarness> {
  const bundle = Bun.file(join(distDir, 'index.js'));

  if (!(await bundle.exists())) {
    throw new Error('Can\'t find webview; try `bun run build:webview`.');
  }

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const pathname = new URL(request.url).pathname;

      if (pathname === '/' || pathname === '/harness.html') {
        return new Response(Bun.file(harnessPath));
      }

      const asset = Bun.file(join(distDir, pathname));
      if (await asset.exists()) {
        return new Response(asset);
      }

      return new Response('Not Found', { status: 404 });
    }
  });

  const browser = await puppeteer.launch({ headless: true });

  return {
    async openLiveEditor(doc, initExtras = {}): Promise<Page> {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 900 });

      await page.goto(`http://127.0.0.1:${server.port}/harness.html`, {
        waitUntil: 'networkidle0',
      });

      await page.evaluate(
        (doc, initExtras) => {
          // Send initial ExtensionMessage.
          window.postMessage(
            {
              type: 'init',
              text: doc,
              mode: 'live',
              version: 1,
              ...initExtras
            },
            '*',
          );
        },
        doc,
        initExtras,
      );

      await page.waitForSelector('.cm-editor.meo-mode-live .cm-line');

      return page;
    },

    async close() {
      // With bun, puppeteer's graceful Browser.close() can stall (https://github.com/oven-sh/bun/issues/31792),
      // so fall back to killing the browser process wholesale.
      await Promise.race([
        browser.close(),
        new Promise((resolve) => setTimeout(resolve, 5_000))
      ]);
      browser.process()?.kill('SIGKILL');
      server.stop(true);
    }
  };
}

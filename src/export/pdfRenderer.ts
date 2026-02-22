import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findPdfBrowserExecutablePath } from './browserDiscovery';

export type HeadlessExportOptions = {
  htmlDocument: string;
  browserExecutablePath?: string;
  puppeteerRuntimeModulePath?: string;
  timeoutMs?: number;
};

export type RenderPdfExportOptions = HeadlessExportOptions & {
  outputPdfPath: string;
};

let puppeteerRuntimePromise: Promise<any> | null = null;

export async function renderPdfFromHtmlExport(options: RenderPdfExportOptions): Promise<void> {
  await withPreparedExportPage(options, { exportTarget: 'pdf' }, async (page) => {
    await page.pdf({
      path: options.outputPdfPath,
      printBackground: true,
      format: 'A4',
      margin: {
        top: '0in',
        right: '0in',
        bottom: '0in',
        left: '0in'
      }
    });
  });
}

export async function finalizeHtmlExportInHeadlessBrowser(options: HeadlessExportOptions): Promise<string> {
  return withPreparedExportPage(options, { exportTarget: 'html' }, async (page) => {
    const serialized = await page.evaluate(() => {
      document.querySelectorAll('script[data-meo-export-runtime], script[data-meo-export-mermaid-runtime]').forEach((node) => {
        node.remove();
      });
      document.querySelectorAll('.meo-export-mermaid').forEach((node) => {
        node.removeAttribute('data-source-b64');
      });
      document.documentElement.removeAttribute('data-meo-export-target');
      document.body.removeAttribute('data-meo-export-target');

      try {
        delete window.__MEO_EXPORT_READY__;
        delete window.__MEO_EXPORT_ERROR__;
      } catch {
        // Ignore delete failures.
      }

      return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    });

    return String(serialized);
  });
}

async function withPreparedExportPage<T>(
  options: HeadlessExportOptions,
  runtimeOptions: {
    exportTarget: 'html' | 'pdf';
  },
  action: (page: any) => Promise<T>
): Promise<T> {
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 30000);
  const browserExecutablePath = await findPdfBrowserExecutablePath(options.browserExecutablePath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meo-export-'));
  const tempHtmlPath = path.join(tempDir, 'render.html');

  let browser: any = null;
  try {
    await fs.writeFile(tempHtmlPath, options.htmlDocument, 'utf8');
    const puppeteer = await loadBundledPuppeteerRuntime(options.puppeteerRuntimeModulePath);

    browser = await puppeteer.launch({
      executablePath: browserExecutablePath,
      headless: true,
      args: [
        '--allow-file-access-from-files',
        '--disable-web-security',
        '--no-first-run',
        '--no-default-browser-check'
      ]
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);
    await page.emulateMediaType('screen');

    await page.goto(pathToFileURL(tempHtmlPath).toString(), {
      waitUntil: 'domcontentloaded'
    });

    if (runtimeOptions.exportTarget === 'pdf') {
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-meo-export-target', 'pdf');
        document.body.setAttribute('data-meo-export-target', 'pdf');
      });
    } else {
      await page.evaluate(() => {
        document.documentElement.removeAttribute('data-meo-export-target');
        document.body.removeAttribute('data-meo-export-target');
      });
    }

    await page.waitForFunction(() => (window as any).__MEO_EXPORT_READY__ === true, {
      timeout: timeoutMs
    });

    return await action(page);
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function loadBundledPuppeteerRuntime(explicitRuntimePath?: string): Promise<any> {
  if (!puppeteerRuntimePromise) {
    const runtimePath = explicitRuntimePath || path.join(__dirname, 'puppeteer-runtime.js');
    const runtimeUrl = pathToFileURL(runtimePath).toString();
    puppeteerRuntimePromise = import(runtimeUrl)
      .then((mod: any) => unwrapPuppeteerRuntime(mod))
      .catch((error) => {
        puppeteerRuntimePromise = null;
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to load PDF export runtime (${runtimePath}). Run the extension build to regenerate it. ${message}`);
      });
  }

  return puppeteerRuntimePromise;
}

function unwrapPuppeteerRuntime(mod: any): any {
  let current = mod;
  for (let i = 0; i < 5; i += 1) {
    if (current && typeof current.launch === 'function') {
      return current;
    }
    if (!current || typeof current !== 'object' || !('default' in current)) {
      break;
    }
    current = current.default;
  }

  throw new Error('Loaded PDF export runtime does not expose a Puppeteer-compatible `launch()` function.');
}

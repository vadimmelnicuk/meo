import * as fs from 'node:fs/promises';
import { finalizeHtmlExportInHeadlessBrowser, type HeadlessExportOptions } from './pdfRenderer';

export type WriteHtmlExportOptions = HeadlessExportOptions & {
  outputHtmlPath: string;
  skipHeadlessFinalize?: boolean;
};

export async function writeFinalizedHtmlExport(options: WriteHtmlExportOptions): Promise<void> {
  if (options.skipHeadlessFinalize) {
    await fs.writeFile(options.outputHtmlPath, options.htmlDocument, 'utf8');
    return;
  }
  const finalizedHtml = await finalizeHtmlExportInHeadlessBrowser(options);
  await fs.writeFile(options.outputHtmlPath, finalizedHtml, 'utf8');
}

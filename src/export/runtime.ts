import { renderMarkdownToHtml } from './renderMarkdown';
import { buildExportHtmlDocument as buildStandaloneExportHtmlDocument } from './exportHtmlTemplate';
import { buildExportStyles, type ExportStyleEnvironment } from './exportStyles';
import { writeFinalizedHtmlExport } from './htmlExport';
import { renderPdfFromHtmlExport } from './pdfRenderer';
import type { ThemeSettings } from '../shared/themeDefaults';

export type ExportRuntimeBuildHtmlOptions = {
  markdownText: string;
  sourceDocumentPath: string;
  outputFilePath: string;
  target: 'html' | 'pdf';
  theme: ThemeSettings;
  styleEnvironment?: ExportStyleEnvironment;
  editorFontEnvironment?: {
    editorFontFamily?: string;
    editorFontSizePx?: number;
  };
  mermaidRuntimeSrc: string;
  katexStylesHref?: string;
  baseHref: string;
  title: string;
};

function renderExportHtmlDocument(
  options: ExportRuntimeBuildHtmlOptions
): { htmlDocument: string; hasMermaid: boolean; hasMath: boolean } {
  const { html: bodyHtml, hasMermaid, hasMath } = renderMarkdownToHtml({
    markdownText: options.markdownText,
    markdownFilePath: options.sourceDocumentPath,
    outputFilePath: options.outputFilePath,
    target: options.target
  });

  const stylesCss = buildExportStyles(
    options.theme,
    {
      ...(options.editorFontEnvironment ?? {}),
      ...(options.styleEnvironment ?? {})
    }
  );

  const htmlDocument = buildStandaloneExportHtmlDocument({
    title: options.title,
    bodyHtml,
    stylesCss,
    hasMermaid,
    hasMath,
    mermaidRuntimeSrc: options.mermaidRuntimeSrc,
    katexStylesHref: options.katexStylesHref,
    baseHref: options.baseHref
  });

  return { htmlDocument, hasMermaid, hasMath };
}

const exportRuntime = {
  renderExportHtmlDocument,
  writeFinalizedHtmlExport,
  renderPdfFromHtmlExport
};

export default exportRuntime;
export type { ExportStyleEnvironment };

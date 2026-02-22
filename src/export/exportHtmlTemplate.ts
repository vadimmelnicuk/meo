export type BuildExportHtmlDocumentOptions = {
  title: string;
  bodyHtml: string;
  stylesCss: string;
  hasMermaid: boolean;
  mermaidRuntimeSrc?: string;
  baseHref?: string;
};

export function buildExportHtmlDocument(options: BuildExportHtmlDocumentOptions): string {
  const title = escapeHtml(options.title || 'Markdown Export');
  const baseTag = options.baseHref ? `<base href="${escapeHtmlAttr(options.baseHref)}" />` : '';
  const mermaidScriptTag = options.hasMermaid && options.mermaidRuntimeSrc
    ? `<script data-meo-export-mermaid-runtime src="${escapeHtmlAttr(options.mermaidRuntimeSrc)}"></script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    ${baseTag}
    <style>${options.stylesCss}</style>
  </head>
  <body>
    <div class="meo-export-page">
      <main id="meo-export-root" class="meo-export-doc">
${options.bodyHtml}
      </main>
    </div>
    ${mermaidScriptTag}
    <script data-meo-export-runtime>
${buildRuntimeScript(options.hasMermaid)}
    </script>
  </body>
</html>`;
}

function buildRuntimeScript(hasMermaid: boolean): string {
  const mermaidFlag = hasMermaid ? 'true' : 'false';
  return `
(() => {
  const root = document.getElementById('meo-export-root');
  window.__MEO_EXPORT_READY__ = false;
  window.__MEO_EXPORT_ERROR__ = null;
  const MERMAID_DIAGRAM_START_RE = /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|quadrantChart|requirementDiagram|c4Context|xychart(?:-beta)?|sankey-beta|block-beta|packet-beta|radar-beta)\\b/i;
  const MERMAID_DISPLAY_MATH_RE = /^\\$\\$[\\s\\S]*\\$\\$$/;
  const MERMAID_DISPLAY_MATH_THEME_CSS =
    '.nodeLabel > div{line-height:1 !important;margin:0 !important;padding:0 !important;}' +
    '.katex-display{margin:0 !important;}' +
    '.katex{line-height:1 !important;}';
  const DISPLAY_MATH_LABEL_SELECTORS = [
    '.nodeLabel .katex-mathml math',
    '.nodeLabel .katex-display',
    '.nodeLabel'
  ];
  const DISPLAY_MATH_TRIM_RETRY_DELAYS_MS = [80, 220];
  const DISPLAY_MATH_VIEWBOX_PADDING = 2;

  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const decodeSource = (value) => {
    try {
      const binary = atob(String(value || ''));
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return '';
    }
  };

  const isDisplayMathDiagram = (diagramText) => MERMAID_DISPLAY_MATH_RE.test(String(diagramText || '').trim());

  const compactDisplayMath = (diagramText) => {
    const inner = String(diagramText || '').trim().slice(2, -2).trim();
    const singleLine = inner
      .split(/\\r?\\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(' ');
    return '$$' + singleLine + '$$';
  };

  const escapeForMermaidLabel = (text) => String(text).replace(/\\\\/g, '\\\\\\\\').replace(/"/g, '\\\\\\"');

  const normalizeMermaidSource = (diagramText) => {
    const text = String(diagramText || '');
    const trimmed = text.trim();
    if (!trimmed || MERMAID_DIAGRAM_START_RE.test(trimmed)) {
      return text;
    }
    if (!isDisplayMathDiagram(trimmed)) {
      return text;
    }

    const escapedMath = escapeForMermaidLabel(compactDisplayMath(trimmed));
    const initConfig = JSON.stringify({
      flowchart: { diagramPadding: 0 },
      themeCSS: MERMAID_DISPLAY_MATH_THEME_CSS
    });

    return [
      '%%{init: ' + initConfig + '}%%',
      'flowchart LR',
      '  MATH["' + escapedMath + '"]',
      '  style MATH fill:transparent,stroke:transparent,stroke-width:0px',
      '  classDef meoMath font-size:22px,padding:0px;',
      '  class MATH meoMath'
    ].join('\\n');
  };

  const trimDisplayMathSvg = (svg) => {
    if (!(svg instanceof SVGSVGElement)) {
      return;
    }

    const applyTrim = () => {
      const screenCtm = svg.getScreenCTM?.();
      if (!screenCtm) {
        return;
      }
      let inverse;
      try {
        inverse = screenCtm.inverse();
      } catch {
        return;
      }

      const points = DISPLAY_MATH_LABEL_SELECTORS
        .map((selector) => svg.querySelector(selector))
        .filter((node) => node instanceof Element)
        .flatMap((node) => {
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return [];
          }

          const transform = (x, y) => {
            if (typeof DOMPoint === 'function') {
              return new DOMPoint(x, y).matrixTransform(inverse);
            }
            const point = svg.createSVGPoint();
            point.x = x;
            point.y = y;
            return point.matrixTransform(inverse);
          };

          return [
            transform(rect.left, rect.top),
            transform(rect.right, rect.top),
            transform(rect.right, rect.bottom),
            transform(rect.left, rect.bottom)
          ];
        });

      let bbox = null;
      if (points.length) {
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        bbox = {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys)
        };
      } else if (typeof svg.getBBox === 'function') {
        try {
          const contentNode = svg.querySelector('.nodes') || svg;
          bbox = contentNode.getBBox();
        } catch {
          bbox = null;
        }
      }

      if (!bbox || bbox.width <= 0 || bbox.height <= 0) {
        return;
      }

      const pad = DISPLAY_MATH_VIEWBOX_PADDING;
      const x = bbox.x - pad;
      const y = bbox.y - pad;
      const width = bbox.width + pad * 2;
      const height = bbox.height + pad * 2;
      svg.setAttribute('viewBox', x + ' ' + y + ' ' + width + ' ' + height);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
    };

    requestAnimationFrame(applyTrim);
    for (const delay of DISPLAY_MATH_TRIM_RETRY_DELAYS_MS) {
      setTimeout(applyTrim, delay);
    }
  };

  const waitForImages = async () => {
    const images = Array.from((root || document).querySelectorAll('img'));
    if (!images.length) {
      return;
    }

    await Promise.all(images.map((img) => {
      if (img.complete) {
        return Promise.resolve();
      }

      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          img.removeEventListener('load', finish);
          img.removeEventListener('error', finish);
          resolve();
        };
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });
        setTimeout(finish, 10000);
      });
    }));
  };

  const renderMermaidBlocks = async () => {
    if (!${mermaidFlag}) {
      return;
    }

    const blocks = Array.from(document.querySelectorAll('.meo-export-mermaid[data-source-b64]'));
    if (!blocks.length) {
      return;
    }

    const mermaidApi = window.mermaid;
    if (!mermaidApi || typeof mermaidApi.render !== 'function') {
      return;
    }

    try {
      mermaidApi.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'dark',
        htmlLabels: true,
        markdownAutoWrap: true,
        flowchart: { htmlLabels: true },
        legacyMathML: true,
        forceLegacyMathML: true,
        fontFamily: getComputedStyle(document.body).fontFamily || undefined
      });
    } catch {
      // Continue with default Mermaid configuration.
    }

    let index = 0;
    for (const block of blocks) {
      const source = decodeSource(block.getAttribute('data-source-b64'));
      if (!source) {
        block.classList.add('is-error');
        continue;
      }

      try {
        const isMath = isDisplayMathDiagram(source);
        if (isMath) {
          block.classList.add('is-math');
        }
        const normalizedSource = normalizeMermaidSource(source);
        const renderId = 'meo-export-mermaid-' + (++index);
        const result = await mermaidApi.render(renderId, normalizedSource);
        const svg = typeof result === 'string' ? result : (result && result.svg) || '';
        if (!svg) {
          throw new Error('Empty Mermaid SVG output');
        }
        block.classList.add('is-rendered');
        block.innerHTML = '<div class="meo-export-mermaid-svg">' + svg + '</div>';
        if (isMath) {
          const svgEl = block.querySelector('svg');
          trimDisplayMathSvg(svgEl);
        }
      } catch (error) {
        block.classList.add('is-error');
        block.innerHTML = '<pre class="meo-export-code-block"><code class="language-mermaid">' +
          escapeHtml(source) + '</code></pre>';
        block.setAttribute('data-meo-export-mermaid-error', String(error && error.message ? error.message : error || 'Mermaid render failed'));
      }
    }
  };

  const finalizeReady = () => {
    window.__MEO_EXPORT_READY__ = true;
    if (root) {
      root.setAttribute('data-meo-export-ready', 'true');
    }
  };

  const run = async () => {
    try {
      await renderMermaidBlocks();
      await waitForImages();
    } catch (error) {
      window.__MEO_EXPORT_ERROR__ = String(error && error.message ? error.message : error || 'Export render failed');
    } finally {
      finalizeReady();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { void run(); }, { once: true });
  } else {
    void run();
  }
})();`.trim();
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

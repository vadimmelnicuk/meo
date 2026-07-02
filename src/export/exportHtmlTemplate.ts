export type BuildExportHtmlDocumentOptions = {
  title: string;
  bodyHtml: string;
  stylesCss: string;
  hasMermaid: boolean;
  hasMath: boolean;
  mermaidRuntimeSrc?: string;
  katexStylesHref?: string;
  baseHref?: string;
};

export function buildExportHtmlDocument(options: BuildExportHtmlDocumentOptions): string {
  const title = escapeHtml(options.title || 'Markdown Export');
  const baseTag = options.baseHref ? `<base href="${escapeHtmlAttr(options.baseHref)}" />` : '';
  const katexStylesTag = options.hasMath && options.katexStylesHref
    ? `<link rel="stylesheet" href="${escapeHtmlAttr(options.katexStylesHref)}" />`
    : '';
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
    ${katexStylesTag}
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

  const getExportThemeVar = (name, fallback) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };

  const resolveCssColor = (value, fallback, property) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return fallback;
    const probe = document.createElement('span');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style[property || 'backgroundColor'] = trimmed;
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe)[property || 'backgroundColor'];
    probe.remove();
    return resolved || fallback;
  };

  const clampColorChannel = (value) => Math.min(255, Math.max(0, Math.round(value)));
  const clampAlpha = (value) => Math.min(1, Math.max(0, value));

  const parseCssNumericChannel = (value, scale) => {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed === 'none') return null;
    if (trimmed.endsWith('%')) {
      const percent = Number.parseFloat(trimmed.slice(0, -1));
      return Number.isFinite(percent) ? (percent / 100) * scale : null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const parseCssAlpha = (value) => {
    if (!value) return 1;
    const parsed = parseCssNumericChannel(value, 1);
    return parsed === null ? 1 : clampAlpha(parsed);
  };

  const formatMermaidRgb = (red, green, blue, alpha) => {
    const r = clampColorChannel(red);
    const g = clampColorChannel(green);
    const b = clampColorChannel(blue);
    const a = clampAlpha(alpha === undefined ? 1 : alpha);
    if (a < 1) {
      return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + Number(a.toFixed(3)) + ')';
    }
    return 'rgb(' + r + ', ' + g + ', ' + b + ')';
  };

  const normalizeRgbColor = (value) => {
    const match = /^rgba?\\(\\s*(.+?)\\s*\\)$/i.exec(value);
    if (!match || !match[1]) return null;
    const parts = match[1].split('/').map((part) => part.trim());
    const channels = (parts[0] || '').split(/[\\s,]+/).filter(Boolean);
    if (channels.length < 3) return null;
    const red = parseCssNumericChannel(channels[0], 255);
    const green = parseCssNumericChannel(channels[1], 255);
    const blue = parseCssNumericChannel(channels[2], 255);
    if (red === null || green === null || blue === null) return null;
    const alpha = parts[1] ? parseCssAlpha(parts[1]) : parseCssAlpha(channels[3]);
    return formatMermaidRgb(red, green, blue, alpha);
  };

  const normalizeSrgbColor = (value) => {
    const match = /^color\\(\\s*srgb\\s+(.+?)\\s*\\)$/i.exec(value);
    if (!match || !match[1]) return null;
    const parts = match[1].split('/').map((part) => part.trim());
    const channels = (parts[0] || '').split(/\\s+/).filter(Boolean);
    if (channels.length < 3) return null;
    const red = parseCssNumericChannel(channels[0], 1);
    const green = parseCssNumericChannel(channels[1], 1);
    const blue = parseCssNumericChannel(channels[2], 1);
    if (red === null || green === null || blue === null) return null;
    return formatMermaidRgb(red * 255, green * 255, blue * 255, parseCssAlpha(parts[1]));
  };

  const normalizeMermaidFallbackColor = (fallback) => {
    const trimmed = String(fallback || '').trim();
    if (!trimmed) return '#ffffff';
    return normalizeRgbColor(trimmed) || normalizeSrgbColor(trimmed) || (/^color\\(/i.test(trimmed) ? '#ffffff' : trimmed);
  };

  const normalizeMermaidColor = (value, fallback) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return normalizeMermaidFallbackColor(fallback);
    const normalized = normalizeRgbColor(trimmed) || normalizeSrgbColor(trimmed);
    if (normalized) return normalized;
    if (/^(?:rgba?|color)\\(/i.test(trimmed)) return normalizeMermaidFallbackColor(fallback);
    return trimmed;
  };

  const getExportThemeColor = (name, fallback, property) => {
    return normalizeMermaidColor(
      resolveCssColor(getExportThemeVar(name, fallback), fallback, property || 'backgroundColor'),
      fallback
    );
  };

  const isProbablyDarkColor = (color) => {
    const match = /rgba?\\(\\s*(\\d+(?:\\.\\d+)?)\\s*,\\s*(\\d+(?:\\.\\d+)?)\\s*,\\s*(\\d+(?:\\.\\d+)?)/i.exec(String(color || ''));
    if (!match) return false;
    const red = Number(match[1]);
    const green = Number(match[2]);
    const blue = Number(match[3]);
    if (![red, green, blue].every(Number.isFinite)) return false;
    return (red * 0.299 + green * 0.587 + blue * 0.114) < 128;
  };

  const getMermaidThemeConfig = () => {
    const bodyStyles = getComputedStyle(document.body);
    const background = getExportThemeColor('--meo-code-bg', bodyStyles.backgroundColor || '#ffffff');
    const darkMode = isProbablyDarkColor(background);
    const nodeBackground = darkMode
      ? getExportThemeColor('--meo-panel-bg', '#2f343d')
      : '#ffffff';
    const foreground = darkMode
      ? getExportThemeColor('--meo-fg', '#c9d1d9', 'color')
      : '#1f2328';
    const border = darkMode
      ? getExportThemeColor('--meo-fg', '#c9d1d9', 'color')
      : '#6e7781';
    return {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        background,
        mainBkg: nodeBackground,
        secondBkg: nodeBackground,
        tertiaryColor: nodeBackground,
        primaryColor: nodeBackground,
        primaryTextColor: foreground,
        primaryBorderColor: border,
        nodeBorder: border,
        lineColor: border,
        textColor: foreground,
        nodeTextColor: foreground,
        edgeLabelBackground: background,
        clusterBkg: background,
        clusterBorder: border,
        titleColor: foreground,
        darkMode
      },
      htmlLabels: true,
      markdownAutoWrap: true,
      flowchart: { htmlLabels: true },
      legacyMathML: true,
      forceLegacyMathML: true,
      fontFamily: bodyStyles.fontFamily || undefined
    };
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
      mermaidApi.initialize(getMermaidThemeConfig());
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

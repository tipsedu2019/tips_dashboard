const EXPORT_PRESETS = {
  'a4-portrait': {
    width: 794,
    padding: 24,
    scale: 4,
    backgroundColor: '#ffffff',
  },
  'a4-landscape': {
    width: 1123,
    padding: 20,
    scale: 3,
    backgroundColor: '#ffffff',
  },
};

function getCaptureOptions(options = {}) {
  const preset = EXPORT_PRESETS[options.preset] || {};
  return {
    width: options.width ?? preset.width ?? 794,
    padding: options.padding ?? preset.padding ?? 32,
    scale: options.scale ?? preset.scale ?? 2,
    backgroundColor:
      options.backgroundColor ??
      preset.backgroundColor ??
      (document.documentElement.getAttribute('data-theme') === 'dark'
        ? '#111712'
        : '#f6f7f3'),
  };
}

function clampFraction(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function parseSrgbChannel(token) {
  if (!token) {
    return null;
  }

  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.endsWith('%')) {
    const parsedPercent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(parsedPercent) ? clampFraction(parsedPercent / 100) : null;
  }

  const parsedValue = Number.parseFloat(trimmed);
  return Number.isFinite(parsedValue) ? clampFraction(parsedValue) : null;
}

function normalizeCssColorFunctions(value) {
  if (!value || !value.includes('color(')) {
    return value;
  }

  return value.replace(/color\(\s*srgb\s+([^()]+?)\)/gi, (match, colorBody) => {
    const [channelSection, alphaSection] = String(colorBody).split(/\s*\/\s*/);
    const channels = String(channelSection)
      .trim()
      .split(/\s+/)
      .map(parseSrgbChannel);

    if (channels.length < 3 || channels.slice(0, 3).some((channel) => channel == null)) {
      return match;
    }

    const [red, green, blue] = channels
      .slice(0, 3)
      .map((channel) => Math.round(clampFraction(channel) * 255));

    if (!alphaSection) {
      return `rgb(${red}, ${green}, ${blue})`;
    }

    const alpha = parseSrgbChannel(alphaSection);
    if (alpha == null) {
      return match;
    }

    return `rgba(${red}, ${green}, ${blue}, ${Number(clampFraction(alpha).toFixed(3))})`;
  });
}

function sanitizeHtml2CanvasColors(element) {
  if (!element || typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return () => {};
  }

  const mutatedNodes = new Map();
  const descendants = Array.from(element.querySelectorAll('*'));

  descendants.forEach((node) => {
    const computedStyle = window.getComputedStyle(node);

    Array.from(computedStyle).forEach((propertyName) => {
      const currentValue = computedStyle.getPropertyValue(propertyName);
      if (!currentValue || !currentValue.includes('color(')) {
        return;
      }

      const normalizedValue = normalizeCssColorFunctions(currentValue);
      if (!normalizedValue || normalizedValue === currentValue || normalizedValue.includes('color(')) {
        return;
      }

      if (!mutatedNodes.has(node)) {
        mutatedNodes.set(node, node.getAttribute('style'));
      }

      node.style.setProperty(propertyName, normalizedValue, 'important');
    });
  });

  return () => {
    mutatedNodes.forEach((originalStyle, node) => {
      if (originalStyle == null) {
        node.removeAttribute('style');
        return;
      }
      node.setAttribute('style', originalStyle);
    });
  };
}

async function renderElementToCanvas(element, options = {}) {
  if (!element) return;

  const originalStyle = element.style.cssText;
  const { width, padding, scale, backgroundColor } = getCaptureOptions(options);
  let restoreSanitizedColors = null;

  try {
    element.style.width = `${width}px`;
    element.style.margin = '0 auto';
    element.style.padding = typeof padding === 'number' ? `${padding}px` : padding;
    element.style.backgroundColor = backgroundColor;
    restoreSanitizedColors = sanitizeHtml2CanvasColors(element);

    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      backgroundColor,
      windowWidth: width,
    });

    return canvas;
  } finally {
    restoreSanitizedColors?.();
    element.style.cssText = originalStyle;
  }
}

export async function captureElementAsPngBlob(element, options = {}) {
  const canvas = await renderElementToCanvas(element, options);
  if (!canvas) {
    return null;
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error('PNG blob capture failed'));
    }, 'image/png');
  });
}

export function downloadBlob(blob, filename) {
  if (!blob) {
    return;
  }

  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = blobUrl;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

export async function exportElementAsImage(element, filename, options = {}) {
  const blob = await captureElementAsPngBlob(element, options);
  downloadBlob(blob, filename);
}

function buildPdfHtml(title, imageSrc) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #ffffff;
        color: #0f172a;
        font-family: "Noto Sans KR", "Malgun Gothic", sans-serif;
      }
      .export-toolbar {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 12px 20px;
        border-bottom: 1px solid #d8e2ef;
        background: rgba(255, 255, 255, 0.96);
      }
      .export-action {
        border: 1px solid #c8d3e1;
        border-radius: 999px;
        background: #ffffff;
        color: #0f172a;
        padding: 8px 14px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }
      .export-sheet {
        padding: 16px;
        display: flex;
        justify-content: center;
      }
      .export-preview {
        display: block;
        width: 100%;
        max-width: 100%;
        height: auto;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
      }
      @media print {
        .export-toolbar { display: none; }
        .export-sheet { padding: 0; }
        .export-preview {
          border-radius: 0;
          box-shadow: none;
        }
      }
    </style>
  </head>
  <body>
    <div class="export-toolbar">
      <button type="button" class="export-action" onclick="window.print()">PDF 저장</button>
      <button type="button" class="export-action" onclick="window.close()">닫기</button>
    </div>
    <div class="export-sheet">
      <img src="${imageSrc}" alt="${title}" class="export-preview" />
    </div>
  </body>
</html>`;
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () =>
      reject(new Error('PDF preview image conversion failed'));
    reader.readAsDataURL(blob);
  });
}

export async function exportElementAsPdf(element, title = '시간표') {
  if (!element || typeof window === 'undefined') {
    throw new Error('PDF export target is not available');
  }

  const imageBlob = await captureElementAsPngBlob(element, {
    preset: 'a4-landscape',
  });
  if (!imageBlob) {
    throw new Error('PDF preview capture failed');
  }

  const imageSrc = await readBlobAsDataUrl(imageBlob);
  const popup = window.open('', '_blank', 'width=1440,height=960');
  if (!popup) {
    throw new Error('PDF preview window could not be opened');
  }

  popup.document.write(buildPdfHtml(title, imageSrc));
  popup.document.close();
}


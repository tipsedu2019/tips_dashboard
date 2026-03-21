const EXPORT_PRESETS = {
  'a4-portrait': {
    width: 794,
    padding: 24,
    scale: 4,
    backgroundColor: '#ffffff',
  },
};

function getCaptureOptions(options = {}) {
  const preset = EXPORT_PRESETS[options.preset] || {};
  return {
    width: options.width ?? preset.width ?? 794,
    padding: options.padding ?? preset.padding ?? 32,
    scale: options.scale ?? preset.scale ?? 2,
    backgroundColor: options.backgroundColor ?? preset.backgroundColor ?? (
      document.documentElement.getAttribute('data-theme') === 'dark'
        ? '#111712'
        : '#f6f7f3'
    ),
  };
}

async function renderElementToCanvas(element, options = {}) {
  if (!element) return;

  const originalStyle = element.style.cssText;
  const { width, padding, scale, backgroundColor } = getCaptureOptions(options);

  try {
    element.style.width = `${width}px`;
    element.style.margin = '0 auto';
    element.style.padding = typeof padding === 'number' ? `${padding}px` : padding;
    element.style.backgroundColor = backgroundColor;

    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(element, {
      scale,
      useCORS: true,
      backgroundColor,
      windowWidth: width
    });

    return canvas;
  } finally {
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

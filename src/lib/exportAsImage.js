const EXPORT_PRESETS = {
  'a4-portrait': {
    width: 794,
    padding: 24,
    scale: 4,
    backgroundColor: '#ffffff',
  },
};

export async function exportElementAsImage(element, filename, options = {}) {
  if (!element) return;

  const originalStyle = element.style.cssText;
  const preset = EXPORT_PRESETS[options.preset] || {};
  const {
    width = preset.width ?? 794,
    padding = preset.padding ?? 32,
    scale = preset.scale ?? 2,
    backgroundColor = preset.backgroundColor ?? (document.documentElement.getAttribute('data-theme') === 'dark'
      ? '#111712'
      : '#f6f7f3'),
  } = options;

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

    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } finally {
    element.style.cssText = originalStyle;
  }
}

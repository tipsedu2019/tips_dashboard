const EXPORT_PRESETS = {
  "a4-portrait": {
    width: 794,
    padding: 24,
    scale: 4,
    backgroundColor: "#ffffff",
  },
  "a4-landscape": {
    width: 1123,
    padding: 20,
    scale: 3,
    backgroundColor: "#ffffff",
  },
} as const;

type ExportPreset = keyof typeof EXPORT_PRESETS;

type ExportOptions = {
  preset?: ExportPreset;
  width?: number;
  padding?: number | string;
  scale?: number;
  backgroundColor?: string;
};

function getCaptureOptions(options: ExportOptions = {}) {
  const preset = options.preset ? EXPORT_PRESETS[options.preset] : undefined;

  return {
    width: options.width ?? preset?.width ?? 794,
    padding: options.padding ?? preset?.padding ?? 32,
    scale: options.scale ?? preset?.scale ?? 2,
    backgroundColor:
      options.backgroundColor ??
      preset?.backgroundColor ??
      (document.documentElement.getAttribute("data-theme") === "dark"
        ? "#111712"
        : "#f6f7f3"),
  };
}

function clampFraction(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function parseSrgbChannel(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.endsWith("%")) {
    const parsedPercent = Number.parseFloat(trimmed.slice(0, -1));
    return Number.isFinite(parsedPercent) ? clampFraction(parsedPercent / 100) : null;
  }

  const parsedValue = Number.parseFloat(trimmed);
  return Number.isFinite(parsedValue) ? clampFraction(parsedValue) : null;
}

function normalizeCssColorFunctions(value: string) {
  if (!value.includes("color(")) {
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
      .map((channel) => Math.round(clampFraction(channel as number) * 255));

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

function sanitizeHtml2CanvasColors(element: HTMLElement) {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return () => {};
  }

  const mutatedNodes = new Map<HTMLElement, string | null>();
  const descendants = Array.from(element.querySelectorAll<HTMLElement>("*"));

  descendants.forEach((node) => {
    const computedStyle = window.getComputedStyle(node);

    Array.from(computedStyle).forEach((propertyName) => {
      const currentValue = computedStyle.getPropertyValue(propertyName);
      if (!currentValue || !currentValue.includes("color(")) {
        return;
      }

      const normalizedValue = normalizeCssColorFunctions(currentValue);
      if (!normalizedValue || normalizedValue === currentValue || normalizedValue.includes("color(")) {
        return;
      }

      if (!mutatedNodes.has(node)) {
        mutatedNodes.set(node, node.getAttribute("style"));
      }

      node.style.setProperty(propertyName, normalizedValue, "important");
    });
  });

  return () => {
    mutatedNodes.forEach((originalStyle, node) => {
      if (originalStyle == null) {
        node.removeAttribute("style");
        return;
      }

      node.setAttribute("style", originalStyle);
    });
  };
}

async function renderElementToCanvas(element: HTMLElement, options: ExportOptions = {}) {
  const originalStyle = element.style.cssText;
  const { width, padding, scale, backgroundColor } = getCaptureOptions(options);
  let restoreSanitizedColors: (() => void) | null = null;

  try {
    element.style.width = `${width}px`;
    element.style.margin = "0 auto";
    element.style.padding = typeof padding === "number" ? `${padding}px` : padding;
    element.style.backgroundColor = backgroundColor;
    restoreSanitizedColors = sanitizeHtml2CanvasColors(element);

    const html2canvas = (await import("html2canvas")).default;
    return html2canvas(element, {
      backgroundColor,
      scale,
      useCORS: true,
      windowWidth: width,
    });
  } finally {
    restoreSanitizedColors?.();
    element.style.cssText = originalStyle;
  }
}

export async function captureElementAsPngBlob(element: HTMLElement, options: ExportOptions = {}) {
  const canvas = await renderElementToCanvas(element, options);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("PNG blob capture failed"));
    }, "image/png");
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = blobUrl;
  link.click();
  URL.revokeObjectURL(blobUrl);
}

export async function exportElementAsImage(
  element: HTMLElement,
  filename: string,
  options: ExportOptions = {},
) {
  const blob = await captureElementAsPngBlob(element, options);
  downloadBlob(blob, filename);
}

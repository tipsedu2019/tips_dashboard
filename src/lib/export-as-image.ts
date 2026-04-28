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
  height?: number;
  padding?: number | string;
  scale?: number;
  backgroundColor?: string;
};

type ResolvedExportOptions = ReturnType<typeof getCaptureOptions>;

const HTML2CANVAS_SAFE_FONT_FAMILY =
  '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", Pretendard, "Pretendard Variable", system-ui, sans-serif';

function getCaptureOptions(options: ExportOptions = {}) {
  const preset = options.preset ? EXPORT_PRESETS[options.preset] : undefined;

  return {
    width: options.width ?? preset?.width ?? 794,
    height: options.height,
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

async function waitForDocumentFonts() {
  if (typeof document === "undefined" || !("fonts" in document)) {
    return;
  }

  try {
    await document.fonts.ready;
  } catch {
    // Font readiness is a quality optimization; export should still continue.
  }
}

function clampFraction(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function clampByte(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(255, Math.max(0, Math.round(value)));
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

function parseAlpha(token?: string) {
  if (!token) {
    return 1;
  }

  return parseSrgbChannel(token);
}

function parseLightness(token: string) {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }

  const value = Number.parseFloat(trimmed.replace("%", ""));
  if (!Number.isFinite(value)) {
    return null;
  }

  if (trimmed.endsWith("%")) {
    return value / 100;
  }

  return value > 1 ? value / 100 : value;
}

function parseAngle(token: string) {
  const trimmed = token.trim();
  const value = Number.parseFloat(trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }

  if (trimmed.endsWith("turn")) {
    return value * 360;
  }
  if (trimmed.endsWith("rad")) {
    return value * (180 / Math.PI);
  }
  if (trimmed.endsWith("grad")) {
    return value * 0.9;
  }

  return value;
}

function parseFunctionChannels(body: string) {
  const [channelSection, alphaSection] = String(body).split(/\s*\/\s*/);
  const channels = String(channelSection).trim().split(/\s+/).filter(Boolean);

  return {
    channels,
    alpha: parseAlpha(alphaSection),
  };
}

function srgbLinearToEncoded(channel: number) {
  const encoded = channel <= 0.0031308
    ? 12.92 * channel
    : (1.055 * Math.pow(channel, 1 / 2.4)) - 0.055;

  return clampByte(encoded * 255);
}

function formatRgbColor(red: number, green: number, blue: number, alpha = 1) {
  const normalizedAlpha = clampFraction(alpha);
  if (normalizedAlpha >= 1) {
    return `rgb(${clampByte(red)}, ${clampByte(green)}, ${clampByte(blue)})`;
  }

  return `rgba(${clampByte(red)}, ${clampByte(green)}, ${clampByte(blue)}, ${Number(normalizedAlpha.toFixed(3))})`;
}

type LegacyColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

function parseHexColor(token: string): LegacyColor | null {
  const normalized = token.trim().replace("#", "");
  if (![3, 4, 6, 8].includes(normalized.length) || /[^a-f0-9]/i.test(normalized)) {
    return null;
  }

  const expanded = normalized.length <= 4
    ? normalized.split("").map((char) => `${char}${char}`).join("")
    : normalized;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;

  return { red, green, blue, alpha };
}

function parseRgbColor(token: string): LegacyColor | null {
  const match = token.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (!match) {
    return null;
  }

  const [channelSection, alphaSection] = match[1].split(/\s*\/\s*/);
  const channels = channelSection.includes(",")
    ? channelSection.split(",").map((part) => part.trim())
    : channelSection.trim().split(/\s+/);
  const legacyAlpha = channels.length > 3 ? channels[3] : alphaSection;
  const parsedChannels = channels.slice(0, 3).map((channel) => {
    if (channel.endsWith("%")) {
      return clampByte((Number.parseFloat(channel) / 100) * 255);
    }

    return clampByte(Number.parseFloat(channel));
  });
  const alpha = parseAlpha(legacyAlpha);

  if (parsedChannels.length < 3 || parsedChannels.some((channel) => !Number.isFinite(channel)) || alpha == null) {
    return null;
  }

  return {
    red: parsedChannels[0],
    green: parsedChannels[1],
    blue: parsedChannels[2],
    alpha,
  };
}

function parseLegacyColor(token: string): LegacyColor | null {
  const trimmed = token.trim();
  if (trimmed === "transparent") {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }

  if (trimmed.startsWith("#")) {
    return parseHexColor(trimmed);
  }

  return parseRgbColor(trimmed);
}

function parseMixWeight(token?: string | null) {
  if (!token) {
    return null;
  }

  const parsed = Number.parseFloat(token);
  return Number.isFinite(parsed) ? clampFraction(parsed / 100) : null;
}

function mixLegacyColors(first: LegacyColor, firstWeight: number, second: LegacyColor, secondWeight: number) {
  const weightSum = firstWeight + secondWeight || 1;
  const normalizedFirstWeight = firstWeight / weightSum;
  const normalizedSecondWeight = secondWeight / weightSum;
  const alpha = (first.alpha * normalizedFirstWeight) + (second.alpha * normalizedSecondWeight);

  if (alpha <= 0) {
    return formatRgbColor(0, 0, 0, 0);
  }

  const red = ((first.red * first.alpha * normalizedFirstWeight) + (second.red * second.alpha * normalizedSecondWeight)) / alpha;
  const green = ((first.green * first.alpha * normalizedFirstWeight) + (second.green * second.alpha * normalizedSecondWeight)) / alpha;
  const blue = ((first.blue * first.alpha * normalizedFirstWeight) + (second.blue * second.alpha * normalizedSecondWeight)) / alpha;

  return formatRgbColor(red, green, blue, alpha);
}

function oklabToRgb(lightness: number, a: number, b: number, alpha = 1) {
  const lPrime = lightness + (0.3963377774 * a) + (0.2158037573 * b);
  const mPrime = lightness - (0.1055613458 * a) - (0.0638541728 * b);
  const sPrime = lightness - (0.0894841775 * a) - (1.2914855480 * b);

  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;

  const red = srgbLinearToEncoded((4.0767416621 * l) - (3.3077115913 * m) + (0.2309699292 * s));
  const green = srgbLinearToEncoded((-1.2684380046 * l) + (2.6097574011 * m) - (0.3413193965 * s));
  const blue = srgbLinearToEncoded((-0.0041960863 * l) - (0.7034186147 * m) + (1.7076147010 * s));

  return formatRgbColor(red, green, blue, alpha);
}

function labToRgb(lightness: number, a: number, b: number, alpha = 1) {
  const l = lightness * 100;
  const fy = (l + 16) / 116;
  const fx = fy + (a / 500);
  const fz = fy - (b / 200);
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const inverse = (value: number) => {
    const cube = value ** 3;
    return cube > epsilon ? cube : ((116 * value) - 16) / kappa;
  };

  const xD50 = 0.96422 * inverse(fx);
  const yD50 = inverse(fy);
  const zD50 = 0.82521 * inverse(fz);

  const xD65 = (0.9555766 * xD50) - (0.0230393 * yD50) + (0.0631636 * zD50);
  const yD65 = (-0.0282895 * xD50) + (1.0099416 * yD50) + (0.0210077 * zD50);
  const zD65 = (0.0122982 * xD50) - (0.0204830 * yD50) + (1.3299098 * zD50);

  const red = srgbLinearToEncoded((3.2404542 * xD65) - (1.5371385 * yD65) - (0.4985314 * zD65));
  const green = srgbLinearToEncoded((-0.9692660 * xD65) + (1.8760108 * yD65) + (0.0415560 * zD65));
  const blue = srgbLinearToEncoded((0.0556434 * xD65) - (0.2040259 * yD65) + (1.0572252 * zD65));

  return formatRgbColor(red, green, blue, alpha);
}

function normalizeOklabFunction(match: string, colorBody: string) {
  const { channels, alpha } = parseFunctionChannels(colorBody);
  const lightness = parseLightness(channels[0] || "");
  const a = Number.parseFloat(channels[1] || "");
  const b = Number.parseFloat(channels[2] || "");

  if (lightness == null || !Number.isFinite(a) || !Number.isFinite(b) || alpha == null) {
    return match;
  }

  return oklabToRgb(lightness, a, b, alpha);
}

function normalizeOklchFunction(match: string, colorBody: string) {
  const { channels, alpha } = parseFunctionChannels(colorBody);
  const lightness = parseLightness(channels[0] || "");
  const chroma = Number.parseFloat(channels[1] || "");
  const hue = parseAngle(channels[2] || "0");

  if (lightness == null || !Number.isFinite(chroma) || hue == null || alpha == null) {
    return match;
  }

  const radians = (hue * Math.PI) / 180;
  return oklabToRgb(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians), alpha);
}

function normalizeLabFunction(match: string, colorBody: string) {
  const { channels, alpha } = parseFunctionChannels(colorBody);
  const lightness = parseLightness(channels[0] || "");
  const a = Number.parseFloat(channels[1] || "");
  const b = Number.parseFloat(channels[2] || "");

  if (lightness == null || !Number.isFinite(a) || !Number.isFinite(b) || alpha == null) {
    return match;
  }

  return labToRgb(lightness, a, b, alpha);
}

function normalizeLchFunction(match: string, colorBody: string) {
  const { channels, alpha } = parseFunctionChannels(colorBody);
  const lightness = parseLightness(channels[0] || "");
  const chroma = Number.parseFloat(channels[1] || "");
  const hue = parseAngle(channels[2] || "0");

  if (lightness == null || !Number.isFinite(chroma) || hue == null || alpha == null) {
    return match;
  }

  const radians = (hue * Math.PI) / 180;
  return labToRgb(lightness, chroma * Math.cos(radians), chroma * Math.sin(radians), alpha);
}

function normalizeColorMixFunction(
  match: string,
  firstColorToken: string,
  firstWeightToken: string | undefined,
  secondColorToken: string,
  secondWeightToken: string | undefined,
) {
  const firstColor = parseLegacyColor(firstColorToken);
  const secondColor = parseLegacyColor(secondColorToken);
  if (!firstColor || !secondColor) {
    return match;
  }

  const firstWeight = parseMixWeight(firstWeightToken);
  const secondWeight = parseMixWeight(secondWeightToken);
  const resolvedFirstWeight = firstWeight ?? (secondWeight == null ? 0.5 : 1 - secondWeight);
  const resolvedSecondWeight = secondWeight ?? (firstWeight == null ? 0.5 : 1 - firstWeight);

  return mixLegacyColors(firstColor, resolvedFirstWeight, secondColor, resolvedSecondWeight);
}

function normalizeCssColorFunctions(value: string) {
  if (!/(?:color-mix|color|lab|lch|oklab|oklch)\(/i.test(value)) {
    return value;
  }

  return value
    .replace(/oklch\(([^()]*)\)/gi, normalizeOklchFunction)
    .replace(/oklab\(([^()]*)\)/gi, normalizeOklabFunction)
    .replace(/lab\(([^()]*)\)/gi, normalizeLabFunction)
    .replace(/lch\(([^()]*)\)/gi, normalizeLchFunction)
    .replace(
      /color-mix\(\s*in\s+srgb\s*,\s*(rgba?\([^()]+\)|#[a-f0-9]{3,8}|transparent)\s*([0-9.]+%)?\s*,\s*(rgba?\([^()]+\)|#[a-f0-9]{3,8}|transparent)\s*([0-9.]+%)?\s*\)/gi,
      normalizeColorMixFunction,
    )
    .replace(/color\(\s*srgb\s+([^()]+?)\)/gi, (match, colorBody) => {
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

    const alpha = parseAlpha(alphaSection);
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
  const descendants = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*"))];

  descendants.forEach((node) => {
    const computedStyle = window.getComputedStyle(node);

    Array.from(computedStyle).forEach((propertyName) => {
      const currentValue = computedStyle.getPropertyValue(propertyName);
      if (!currentValue || !/(?:color-mix|color|lab|lch|oklab|oklch)\(/i.test(currentValue)) {
        return;
      }

      const normalizedValue = normalizeCssColorFunctions(currentValue);
      if (
        !normalizedValue ||
        normalizedValue === currentValue ||
        /(?:color-mix|color|lab|lch|oklab|oklch)\(/i.test(normalizedValue)
      ) {
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

function sanitizeHtml2CanvasDocumentBackground(backgroundColor: string) {
  if (typeof document === "undefined") {
    return () => {};
  }

  const targets = [document.documentElement, document.body].filter(Boolean) as HTMLElement[];
  const snapshots = targets.map((node) => ({
    node,
    cssText: node.style.cssText,
  }));

  targets.forEach((node) => {
    node.style.setProperty("background", backgroundColor, "important");
    node.style.setProperty("background-color", backgroundColor, "important");
  });

  return () => {
    snapshots.forEach(({ node, cssText }) => {
      node.style.cssText = cssText;
    });
  };
}

function prepareElementForImageExport(element: HTMLElement, options: ResolvedExportOptions) {
  const originalStyle = element.style.cssText;
  const { width, height, padding, backgroundColor } = getCaptureOptions(options);
  const originalExportingState = element.getAttribute("data-image-exporting");

  element.setAttribute("data-image-exporting", "true");
  element.style.width = `${width}px`;
  if (height) {
    element.style.minHeight = `${height}px`;
  }
  element.style.margin = "0 auto";
  element.style.padding = typeof padding === "number" ? `${padding}px` : padding;
  element.style.backgroundColor = backgroundColor;

  return () => {
    if (originalExportingState == null) {
      element.removeAttribute("data-image-exporting");
    } else {
      element.setAttribute("data-image-exporting", originalExportingState);
    }
    element.style.cssText = originalStyle;
  };
}

function sanitizeHtml2CanvasTextRendering(element: HTMLElement) {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return () => {};
  }

  const mutatedNodes = new Map<HTMLElement, string | null>();
  const descendants = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*"))];

  descendants.forEach((node) => {
    const computedStyle = window.getComputedStyle(node);
    const letterSpacing = computedStyle.getPropertyValue("letter-spacing");
    const hasAdjustedLetterSpacing = letterSpacing && letterSpacing !== "normal" && letterSpacing !== "0px";
    const isTextNode =
      computedStyle.getPropertyValue("font-family") ||
      computedStyle.getPropertyValue("font-size") ||
      node.textContent?.trim();

    if (!hasAdjustedLetterSpacing && !isTextNode) {
      return;
    }

    if (!mutatedNodes.has(node)) {
      mutatedNodes.set(node, node.getAttribute("style"));
    }

    node.style.setProperty("font-family", HTML2CANVAS_SAFE_FONT_FAMILY, "important");
    node.style.setProperty("letter-spacing", "0", "important");
    node.style.setProperty("font-variant-ligatures", "none", "important");
    node.style.setProperty("font-feature-settings", "normal", "important");
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

function canvasToPngBlob(canvas: HTMLCanvasElement) {
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

async function renderElementToBlobWithHtmlToImage(
  element: HTMLElement,
  options: ResolvedExportOptions,
) {
  await waitForDocumentFonts();

  const { width, height, scale, backgroundColor } = options;
  const captureHeight = height ?? Math.ceil(element.scrollHeight);
  const { toBlob } = await import("html-to-image");
  const blob = await toBlob(element, {
    backgroundColor,
    cacheBust: true,
    height: captureHeight,
    pixelRatio: scale,
    skipAutoScale: true,
    width,
    style: {
      backgroundColor,
      height: `${captureHeight}px`,
      width: `${width}px`,
    },
  });

  if (!blob) {
    throw new Error("PNG blob capture failed");
  }

  return blob;
}

async function renderElementToBlobWithHtml2Canvas(
  element: HTMLElement,
  options: ResolvedExportOptions,
) {
  await waitForDocumentFonts();

  const { width, height, scale, backgroundColor } = options;
  let restoreSanitizedColors: (() => void) | null = null;
  let restoreDocumentBackground: (() => void) | null = null;
  let restoreTextRendering: (() => void) | null = null;

  try {
    restoreDocumentBackground = sanitizeHtml2CanvasDocumentBackground(backgroundColor);
    restoreSanitizedColors = sanitizeHtml2CanvasColors(element);
    restoreTextRendering = sanitizeHtml2CanvasTextRendering(element);

    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(element, {
      backgroundColor,
      scale,
      useCORS: true,
      windowWidth: width,
      windowHeight: height ?? Math.ceil(element.scrollHeight),
      ...(height ? { height } : {}),
    });

    return canvasToPngBlob(canvas);
  } finally {
    restoreTextRendering?.();
    restoreSanitizedColors?.();
    restoreDocumentBackground?.();
  }
}

export async function captureElementAsPngBlob(element: HTMLElement, options: ExportOptions = {}) {
  const captureOptions = getCaptureOptions(options);
  const restoreElement = prepareElementForImageExport(element, captureOptions);

  try {
    try {
      return await renderElementToBlobWithHtmlToImage(element, captureOptions);
    } catch (primaryError) {
      console.warn("html-to-image export failed; falling back to html2canvas.", primaryError);
      return await renderElementToBlobWithHtml2Canvas(element, captureOptions);
    }
  } finally {
    restoreElement();
  }
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

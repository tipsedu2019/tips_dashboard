import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const declarations = (selector) => Object.fromEntries(
  [...css.match(new RegExp(`${selector} \\{([\\s\\S]*?)\\n\\}`))[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value]),
);
const light = declarations(":root");
const themes = { light, dark: { ...light, ...declarations("\\.dark") } };

// CSS Color 4 OKLab -> linear sRGB, then the WCAG relative luminance formula.
// Clamp out-of-gamut channels to sRGB; browser-rendered state QA is a separate gate.
function color(tokens, name) {
  const value = tokens[name];
  if (value.startsWith("var(")) return color(tokens, value.slice(4, -1));
  const [l, c, h] = value.match(/[\d.]+/g).map(Number);
  const a = c * Math.cos(h * Math.PI / 180);
  const b = c * Math.sin(h * Math.PI / 180);
  const x = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const y = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const z = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621*x - 3.3077115913*y + 0.2309699292*z,
    -1.2684380046*x + 2.6097574011*y - 0.3413193965*z,
    -0.0041960863*x - 0.7034186147*y + 1.707614701*z]
    .map((v) => Math.max(0, Math.min(1, v)))
    .map((v) => v <= 0.0031308 ? 12.92*v : 1.055*v**(1/2.4) - 0.055);
}
function luminance(rgb) {
  return rgb.map((v) => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4)
    .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const [low, high] = [luminance(a), luminance(b)].sort((a,b) => a-b);
  return (high+0.05)/(low+0.05);
}
const mix = (color, base, alpha) => color.map((v,i) => v*alpha + base[i]*(1-alpha));

for (const [theme, tokens] of Object.entries(themes)) {
  test(`${theme}: body, supporting text, selection, primary and destructive states meet 4.5:1`, (t) => {
    const pairs = [
      ["--foreground", "--background"], ["--card-foreground", "--card"],
      ["--popover-foreground", "--popover"], ["--secondary-foreground", "--secondary"],
      ["--accent-foreground", "--accent"], ["--sidebar-foreground", "--sidebar"],
      ["--sidebar-accent-foreground", "--sidebar-accent"],
      ...["--background", "--card", "--muted", "--accent"].map((bg) => ["--muted-foreground", bg]),
      ...["--primary", "--destructive"].flatMap((fg) => [
        [fg, "--background"], [fg, "--card"], [`${fg}-foreground`, fg],
      ]),
    ];
    for (const [fg, bg] of pairs) {
      const value = contrast(color(tokens, fg), color(tokens, bg));
      assert.ok(value >= 4.5, `${theme} ${fg}/${bg}: ${value.toFixed(2)}`);
      t.diagnostic(`${fg}/${bg}: ${value.toFixed(2)}:1`);
    }
    for (const action of ["--primary", "--destructive"]) {
      for (const surface of ["--background", "--card"]) {
        const hover = mix(color(tokens, action), color(tokens, surface), 0.9);
        const value = contrast(color(tokens, `${action}-foreground`), hover);
        assert.ok(value >= 4.5, `${theme} ${action} hover on ${surface}: ${value.toFixed(2)}`);
        t.diagnostic(`${action} hover on ${surface}: ${value.toFixed(2)}:1`);
      }
    }
  });
}

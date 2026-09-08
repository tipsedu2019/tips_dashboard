import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import vm from "node:vm"
import ts from "typescript"

const require = createRequire(import.meta.url)
const root = new URL("../../", import.meta.url)

// Keep the real component tree and local imports; replace only explicit test
// boundaries. A null Supabase client prevents accidental authenticated requests.
export function loadNotificationComponent(path, overrides = new Map()) {
  const modules = new Map([["@/lib/supabase", { supabase: null }], ...overrides])
  const cache = new Map()
  function load(url) {
    if (cache.has(url.href)) return cache.get(url.href).exports
    const runtime = { exports: {} }
    cache.set(url.href, runtime)
    const code = ts.transpileModule(readFileSync(url, "utf8"), {
      fileName: url.pathname,
      compilerOptions: {
        esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      },
    }).outputText
    const resolve = (specifier) => {
      if (modules.has(specifier)) return modules.get(specifier)
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return require(specifier)
      const stem = specifier.startsWith("@/") ? new URL(`src/${specifier.slice(2)}`, root) : new URL(specifier, url)
      const target = [stem, ...[".ts", ".tsx", ".js"].map((suffix) => new URL(stem.href + suffix))].find(existsSync)
      assert.ok(target, `missing production import ${specifier}`)
      return load(target)
    }
    vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename: url.pathname })(resolve, runtime, runtime.exports)
    return runtime.exports
  }
  return load(new URL(path, root))
}

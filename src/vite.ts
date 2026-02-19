import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import type { Plugin } from 'vite';

const VIRTUAL_ID = 'virtual:playwright-injected';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const ISO_PREFIX = '@playwright-isomorphic/';
const ISO_RESOLVED_PREFIX = '\0@playwright-isomorphic/';

/**
 * Vite plugin that extracts Playwright's InjectedScript and locator utilities
 * from `playwright-core` and serves them as importable ES modules.
 *
 * Usage:
 * ```ts
 * import playwrightInjected from 'playwright-injected/vite'
 *
 * export default defineConfig({
 *   plugins: [playwrightInjected()],
 * })
 * ```
 *
 * Then import in your code:
 * ```ts
 * import { InjectedScript } from 'virtual:playwright-injected'
 * import { asLocator } from '@playwright-isomorphic/locatorGenerators'
 * ```
 */
export default function playwrightInjected(): Plugin {
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve('playwright-core/package.json');
  const pkgDir = dirname(pkgPath);
  const isomorphicDir = resolve(pkgDir, 'lib/utils/isomorphic');

  /** Evaluate a CJS module with require shim to discover export names */
  function getCjsExportNames(filePath: string): string[] {
    const source = readFileSync(filePath, 'utf-8');
    const m = { exports: {} as Record<string, unknown> };
    const requireShim = (id: string): Record<string, unknown> => {
      if (id.startsWith('./')) {
        const siblingPath = resolve(
          dirname(filePath),
          id.endsWith('.js') ? id : id + '.js',
        );
        if (existsSync(siblingPath)) {
          const sm = { exports: {} as Record<string, unknown> };
          new Function(
            'module',
            'exports',
            'require',
            readFileSync(siblingPath, 'utf-8'),
          )(sm, sm.exports, requireShim);
          return sm.exports;
        }
      }
      return {};
    };
    new Function('module', 'exports', 'require', source)(
      m,
      m.exports,
      requireShim,
    );
    return Object.keys(m.exports);
  }

  return {
    name: 'playwright-injected',

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
      if (id.startsWith(ISO_PREFIX))
        return ISO_RESOLVED_PREFIX + id.slice(ISO_PREFIX.length);
    },

    load(id) {
      // InjectedScript virtual module
      if (id === RESOLVED_ID) {
        const sourcePath = resolve(
          pkgDir,
          'lib/generated/injectedScriptSource.js',
        );
        const fileContent = readFileSync(sourcePath, 'utf-8');

        const m = { exports: {} as Record<string, unknown> };
        new Function('module', 'exports', fileContent)(m, m.exports);
        const innerSource = m.exports.source as string;

        return [
          '// Extracted from playwright-core at build time',
          'const __pw = (() => {',
          '  const module = { exports: {} };',
          '  const exports = module.exports;',
          innerSource,
          '  const resolved = {};',
          '  for (const [k, v] of Object.entries(module.exports)) {',
          '    resolved[k] = typeof v === "function" && !v.prototype ? v() : v;',
          '  }',
          '  return resolved;',
          '})();',
          'export const InjectedScript = __pw.InjectedScript;',
        ].join('\n');
      }

      // @playwright-isomorphic/* virtual modules — convert CJS to ESM
      if (id.startsWith(ISO_RESOLVED_PREFIX)) {
        const moduleName = id.slice(ISO_RESOLVED_PREFIX.length);
        const filePath = resolve(isomorphicDir, moduleName + '.js');
        if (!existsSync(filePath)) return;

        const exportNames = getCjsExportNames(filePath);

        // Generate ESM that imports siblings as ESM and provides them via require shim
        const source = readFileSync(filePath, 'utf-8');
        // Find all require("./...") calls to generate ESM imports
        const requirePattern = /require\("\.\/([\w-]+)"\)/g;
        const siblings = new Set<string>();
        let match;
        while ((match = requirePattern.exec(source)) !== null) {
          siblings.add(match[1]);
        }

        const imports = [...siblings].map(
          (name, i) => `import * as __dep${i} from '${ISO_PREFIX}${name}';`,
        );
        const depMap = [...siblings].map(
          (name, i) => `    "./${name}": __dep${i},`,
        );

        return [
          ...imports,
          '',
          'const __mod = (() => {',
          '  const __deps = {',
          ...depMap,
          '  };',
          '  const require = (id) => __deps[id] || {};',
          '  const module = { exports: {} };',
          '  const exports = module.exports;',
          source,
          '  return module.exports;',
          '})();',
          '',
          ...exportNames.map((name) => `export const ${name} = __mod.${name};`),
        ].join('\n');
      }
    },
  };
}

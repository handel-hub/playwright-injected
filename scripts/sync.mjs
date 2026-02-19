#!/usr/bin/env node

/**
 * Syncs the library with the Playwright source.
 *
 * 1. Clones the playwright repo if not present
 * 2. Builds the ESM bundle from .ts sources using esbuild
 * 3. Generates .d.ts type declarations using tsc
 *
 * Output: src/generated/
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PW = path.join(ROOT, 'playwright');
const INJECTED_SRC = path.join(PW, 'packages', 'injected', 'src');
const ISO_SRC = path.join(
  PW,
  'packages',
  'playwright-core',
  'src',
  'utils',
  'isomorphic',
);
const OUT_DIR = path.join(ROOT, 'src', 'generated');

// --- Step 1: Ensure playwright repo exists ---

if (!fs.existsSync(path.join(PW, 'packages'))) {
  console.log('Cloning playwright repo...');
  execSync(
    'git clone --depth 1 https://github.com/microsoft/playwright.git playwright',
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );
  console.log('Installing playwright dependencies...');
  execSync('npm install', { cwd: PW, stdio: 'inherit' });
}

// --- Step 2: Build ESM bundle with esbuild ---

// Generate barrel from all .ts files in both packages
const injectedFiles = fs
  .readdirSync(INJECTED_SRC)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map((f) => f.replace('.ts', ''));

const isoFiles = fs
  .readdirSync(ISO_SRC)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map((f) => f.replace('.ts', ''));

const barrel =
  [
    '// Auto-generated barrel file — do not edit',
    '// Injected',
    ...injectedFiles.map((f) => `export * from '@injected/${f}';`),
    '',
    '// Isomorphic',
    ...isoFiles.map((f) => `export * from '@isomorphic/${f}';`),
  ].join('\n') + '\n';

const barrelPath = path.join(ROOT, 'src', '_barrel.ts');
fs.writeFileSync(barrelPath, barrel);

const inlineCSSPlugin = {
  name: 'inlineCSSPlugin',
  setup(build) {
    build.onResolve({ filter: /\.css\?inline$/ }, (args) => ({
      path: path.resolve(path.dirname(args.importer), args.path),
      namespace: 'file',
    }));
    build.onLoad({ filter: /\.css\?inline$/ }, async (args) => {
      const cssPath = args.path.replace('?inline', '');
      const f = await fs.promises.readFile(cssPath);
      const css = await esbuild.transform(f, { loader: 'css', minify: true });
      return { loader: 'text', contents: css.code };
    });
  },
};

console.log('Building ESM bundle from playwright source...');

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const result = await esbuild.build({
  entryPoints: [barrelPath],
  bundle: true,
  outfile: path.join(OUT_DIR, 'playwright-bundle.js'),
  format: 'esm',
  platform: 'browser',
  target: 'ES2020',
  plugins: [inlineCSSPlugin],
  alias: {
    '@injected': INJECTED_SRC,
    '@isomorphic': ISO_SRC,
    '@protocol': path.join(PW, 'packages', 'protocol', 'src'),
  },
  treeShaking: true,
});

for (const message of [...result.errors, ...result.warnings])
  console.log(message.text);

fs.unlinkSync(barrelPath);

// Generate matching .d.ts
const dts = barrel
  .replace(/@injected\//g, '@playwright-injected/')
  .replace(/@isomorphic\//g, '@playwright-isomorphic/');
fs.writeFileSync(path.join(OUT_DIR, 'playwright-bundle.d.ts'), dts);

const bundleSize = fs.statSync(path.join(OUT_DIR, 'playwright-bundle.js')).size;
console.log(`  playwright-bundle.js (${(bundleSize / 1024).toFixed(1)} KB)`);
console.log(`  playwright-bundle.d.ts`);

// --- Step 3: Generate .d.ts with tsc ---

console.log('\nGenerating type declarations...');

// CSS stub for highlight.ts
const cssStub = path.join(PW, 'css-inline.d.ts');
fs.writeFileSync(
  cssStub,
  "declare module '*.css?inline' { const css: string; export default css; }\n",
);

// Temporary tsconfig
const tsconfig = path.join(PW, 'tsconfig.gen.json');
fs.writeFileSync(
  tsconfig,
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ESNext', 'DOM', 'DOM.Iterable'],
        declaration: true,
        emitDeclarationOnly: true,
        outDir: '../src/generated',
        skipLibCheck: true,
        useUnknownInCatchVariables: false,
        jsx: 'react-jsx',
        esModuleInterop: true,
        strict: true,
        baseUrl: '.',
        paths: {
          '@isomorphic/*': ['packages/playwright-core/src/utils/isomorphic/*'],
          '@protocol/*': ['packages/protocol/src/*'],
          '@injected/*': ['packages/injected/src/*'],
        },
      },
      include: [
        'packages/injected/src/*.ts',
        'packages/playwright-core/src/utils/isomorphic/*.ts',
        'css-inline.d.ts',
      ],
    },
    null,
    2,
  ),
);

execSync(`npx tsc --project ${tsconfig}`, { cwd: PW, stdio: 'inherit' });

// Clean up temp files
fs.unlinkSync(cssStub);
fs.unlinkSync(tsconfig);

const dtsCount = execSync(`find ${OUT_DIR} -name "*.d.ts" | wc -l`)
  .toString()
  .trim();
console.log(`  ${dtsCount} .d.ts files generated`);

// --- Step 4: Record source git hash ---

const cwd = PW;
const gitHash = execSync('git rev-parse HEAD', { cwd }).toString().trim();
const gitDate = execSync('git log -1 --format=%ci', { cwd }).toString().trim();
const info = Object.entries({ SOURCE_HASH: gitHash, SOURCE_DATE: gitDate });
fs.appendFileSync(
  path.join(OUT_DIR, 'playwright-bundle.d.ts'),
  info.map(([k, v]) => `export declare const PW_${k}: '${v}';`).join('\n'),
);
fs.appendFileSync(
  path.join(OUT_DIR, 'playwright-bundle.js'),
  info.map(([k, v]) => `export const PW_${k} = '${v}';`).join('\n'),
);
console.log(`\nPlaywright source: ${gitHash.slice(0, 8)} (${gitDate})`);
console.log('Done.');

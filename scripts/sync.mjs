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
const OUT_DIR = path.join(ROOT, 'src', 'generated');

const args = process.argv.slice(2);
const isMain = args.includes('--main');
const versionIndex = args.indexOf('--version');
const versionArg = versionIndex !== -1 ? args[versionIndex + 1] : null;

let targetRef = 'main';

if (isMain) {
  targetRef = 'main';
} else if (versionArg) {
  targetRef = versionArg;
} else {
  console.log('Finding latest stable Playwright release...');
  const output = execSync('git ls-remote --tags --refs https://github.com/microsoft/playwright.git').toString();
  const tags = output
    .split('\n')
    .map(line => line.split('\t')[1])
    .filter(ref => ref && ref.startsWith('refs/tags/v'))
    .map(ref => ref.replace('refs/tags/', ''))
    .filter(tag => /^v\d+\.\d+\.\d+$/.test(tag));

  tags.sort((a, b) => {
    const partsA = a.substring(1).split('.').map(Number);
    const partsB = b.substring(1).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if (partsA[i] !== partsB[i]) return partsA[i] - partsB[i];
    }
    return 0;
  });

  targetRef = tags[tags.length - 1];
  console.log(`Latest stable release found: ${targetRef}`);
}

// --- Step 1: Ensure playwright repo exists ---

if (!fs.existsSync(path.join(PW, 'packages'))) {
  console.log(`Cloning playwright repo at ${targetRef}...`);
  execSync(
    `git clone --depth 1 --branch ${targetRef} https://github.com/microsoft/playwright.git playwright`,
    {
      cwd: ROOT,
      stdio: 'inherit',
    },
  );
  console.log('Installing playwright dependencies...');
  execSync('npm install', { cwd: PW, stdio: 'inherit' });
} else {
  console.log(`Fetching ${targetRef} in existing playwright repo...`);
  execSync(`git fetch --depth 1 origin ${targetRef}`, { cwd: PW, stdio: 'inherit' });
  execSync(`git reset --hard FETCH_HEAD`, { cwd: PW, stdio: 'inherit' });
  console.log('Installing playwright dependencies...');
  execSync('npm install', { cwd: PW, stdio: 'inherit' });
}

// --- Step 2: Auto-detect Isomorphic Source Directory ---

// Playwright moves this directory frequently. We will check all known historical 
// and current locations to find where the isomorphic tools actually live.
const possibleIsoPaths = [
  path.join(PW, 'packages', 'isomorphic'),                                     // Playwright 1.63+ (No 'src' folder!)
  path.join(PW, 'packages', 'isomorphic', 'src'),                              // Playwright ~1.62
  path.join(PW, 'packages', 'playwright', 'src', 'isomorphic'),                
  path.join(PW, 'packages', 'utils', 'src', 'isomorphic'),                     // Playwright ~1.45 - 1.61
  path.join(PW, 'packages', 'playwright-core', 'src', 'utils', 'isomorphic'),  // Playwright ~1.30 - 1.44
  path.join(PW, 'packages', 'playwright-core', 'src', 'isomorphic'),
];

let ISO_SRC = '';
for (const p of possibleIsoPaths) {
  if (fs.existsSync(path.join(p, 'selectorParser.ts'))) {
    ISO_SRC = p;
    break;
  }
}

if (!ISO_SRC) {
  console.error('ERROR: Could not locate the isomorphic directory containing selectorParser.ts');
  console.error('Playwright might have restructured its directories again.');
  process.exit(1);
}

const relativeIsoSrc = path.relative(PW, ISO_SRC).replace(/\\/g, '/');
console.log(`Located isomorphic directory at: ${relativeIsoSrc}`);

// --- Step 3: Build ESM bundle with esbuild ---

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

// --- Step 4: Generate .d.ts with tsc ---

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
        strict: false,           // <-- Changed to false to avoid isolated strictness errors
        rootDir: '.',
        types: ['node'],         // <-- Added to resolve Buffer and NodeJS
        paths: {
          '@isomorphic/*': [`./${relativeIsoSrc}/*`],
          '@protocol/*': ['./packages/protocol/src/*'],
          '@injected/*': ['./packages/injected/src/*'],
          '@trace/*': ['./packages/trace/src/*', './packages/trace/*'], // <-- Added to resolve @trace imports
        },
      },
      include: [
        './packages/injected/src/*.ts',
        `./${relativeIsoSrc}/*.ts`,
        './css-inline.d.ts',
      ],
    },
    null,
    2,
  ),
);

// Run tsc and gracefully handle internal Playwright type errors
try {
  execSync(`npx tsc --project ${tsconfig}`, { cwd: PW, stdio: 'inherit' });
} catch (error) {
  console.log('\nWarning: tsc reported internal type errors, but .d.ts files were still generated. Continuing...');
}

// Clean up temp files
fs.unlinkSync(cssStub);
fs.unlinkSync(tsconfig);

function countDtsFiles(dir) {
  let count = 0;
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const file of files) {
    if (file.isDirectory()) {
      count += countDtsFiles(path.join(dir, file.name));
    } else if (file.name.endsWith('.d.ts')) {
      count++;
    }
  }
  return count;
}
const dtsCount = countDtsFiles(OUT_DIR);
console.log(`  ${dtsCount} .d.ts files generated`);

// --- Step 5: Record source git hash & sync package version ---

const cwd = PW;
const gitHash = execSync('git rev-parse HEAD', { cwd }).toString().trim();
const gitDate = execSync('git log -1 --format=%ci', { cwd }).toString().trim();

// Derive version from the playwright git tag safely
let gitTag = '';
try {
  gitTag = execSync('git describe --tags --exact-match HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch (e) {
  // Ignored - branch is not on a tag
}

const version = gitTag.replace(/^v/, '');
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.log(`\nWarning: HEAD is not on a semver tag. Skipping package.json version update.`);
} else {
  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  pkg.version = version;
  pkg.devDependencies['playwright-core'] = version;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`\npackage.json version set to ${version} (playwright-core: ${version})`);
}

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

console.log('\nSync complete.');


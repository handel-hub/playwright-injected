import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { defineConfig } from 'vite';
import playwrightInjected from './src/vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Rewrite path aliases in a .d.ts file to relative paths */
function rewriteAliases(content: string): string {
  return content
    .replace(/'@isomorphic\/(\w+)'/g, "'../isomorphic/$1'")
    .replace(/'@protocol\/channels'/g, "'../protocol/channels'");
}

export default defineConfig({
  plugins: [
    // Only needed for `npm run dev` (the demo app)
    playwrightInjected(),
    {
      name: 'generate-dts',
      closeBundle() {
        const generatedDir = resolve(__dirname, 'src/generated');
        
        // Updated to include 'packages/' due to rootDir: '.' in tsconfig
        const injSrcDir = resolve(generatedDir, 'packages/injected/src');

        // Auto-detect generated isomorphic directory
        const possibleIsoPaths = [
          'packages/isomorphic',
          'packages/isomorphic/src',
          'packages/playwright/src/isomorphic',
          'packages/utils/src/isomorphic',
          'packages/playwright-core/src/utils/isomorphic',
          'packages/playwright-core/src/isomorphic',
        ];

        let isoSrcDir = '';
        for (const p of possibleIsoPaths) {
          const testPath = resolve(generatedDir, p);
          if (existsSync(testPath)) {
            isoSrcDir = testPath;
            break;
          }
        }

        if (!isoSrcDir) {
          throw new Error('Could not auto-detect the generated isomorphic directory in src/generated');
        }

        const typesDir = resolve(__dirname, 'dist/_types');
        const injDestDir = resolve(typesDir, 'injected');
        const isoDestDir = resolve(typesDir, 'isomorphic');
        const protoDestDir = resolve(typesDir, 'protocol');

        mkdirSync(injDestDir, { recursive: true });
        mkdirSync(isoDestDir, { recursive: true });
        mkdirSync(protoDestDir, { recursive: true });

        // Copy injected .d.ts files with rewritten paths
        for (const file of readdirSync(injSrcDir).filter((f) =>
          f.endsWith('.d.ts'),
        )) {
          const content = readFileSync(resolve(injSrcDir, file), 'utf-8');
          writeFileSync(resolve(injDestDir, file), rewriteAliases(content));
        }

        // Copy isomorphic .d.ts files with rewritten paths
        for (const file of readdirSync(isoSrcDir).filter((f) =>
          f.endsWith('.d.ts'),
        )) {
          const content = readFileSync(resolve(isoSrcDir, file), 'utf-8');
          writeFileSync(resolve(isoDestDir, file), rewriteAliases(content));
        }

        // Stub for @protocol/channels (Playwright-internal protocol types)
        writeFileSync(
          resolve(protoDestDir, 'channels.d.ts'),
          [
            'export type FrameExpectParams = Record<string, any>;',
            'export type OriginStorage = Record<string, any>;',
            'export type SetOriginStorage = Record<string, any>;',
            'export type ClientSideCallMetadata = Record<string, any>;',
            'export type StackFrame = { file: string; line: number; column: number; function?: string };',
            '',
          ].join('\n'),
        );

        // Use TypeScript's type checker to get each module's exports
        const allDtsFiles = [
          ...readdirSync(injDestDir)
            .filter((f) => f.endsWith('.d.ts'))
            .map((f) => resolve(injDestDir, f)),
          ...readdirSync(isoDestDir)
            .filter((f) => f.endsWith('.d.ts'))
            .map((f) => resolve(isoDestDir, f)),
        ];
        const program = ts.createProgram(allDtsFiles, {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          skipLibCheck: true,
        });
        const checker = program.getTypeChecker();

        function getModuleExportNames(filePath: string): string[] {
          const sf = program.getSourceFile(filePath);
          if (!sf) return [];
          const symbol = checker.getSymbolAtLocation(sf);
          if (!symbol) return [];
          return checker.getExportsOfModule(symbol).map((s) => s.name);
        }

        // Build barrel with automatic conflict detection
        const barrelDts = readFileSync(
          resolve(generatedDir, 'playwright-bundle.d.ts'),
          'utf-8',
        );
        const seenNames = new Set<string>();
        const barrelLines: string[] = [];

        for (const line of barrelDts.split('\n')) {
          const match = line.match(
            /export \* from '(@playwright-injected|@playwright-isomorphic)\/(\w+)'/,
          );
          if (!match) {
            barrelLines.push(line);
            continue;
          }

          const [, prefix, name] = match;
          const destDir =
            prefix === '@playwright-injected' ? injDestDir : isoDestDir;
          const importPath =
            prefix === '@playwright-injected'
              ? `./_types/injected/${name}`
              : `./_types/isomorphic/${name}`;
          const filePath = resolve(destDir, `${name}.d.ts`);

          const exportNames = getModuleExportNames(filePath);
          const unique = exportNames.filter((n) => !seenNames.has(n));
          for (const n of unique) seenNames.add(n);

          if (unique.length === exportNames.length) {
            barrelLines.push(`export * from '${importPath}';`);
          } else if (unique.length > 0) {
            barrelLines.push(
              `export { ${unique.join(', ')} } from '${importPath}';`,
            );
          }
        }

        writeFileSync(
          resolve(__dirname, 'dist/index.d.ts'),
          barrelLines.join('\n') + '\n',
        );

        // vite.d.ts
        writeFileSync(
          resolve(__dirname, 'dist/vite.d.ts'),
          "import type { Plugin } from 'vite';\nexport default function playwrightInjected(): Plugin;\n",
        );

        // virtual-playwright-injected.d.ts
        copyFileSync(
          resolve(__dirname, 'src/virtual-playwright-injected.d.ts'),
          resolve(__dirname, 'dist/virtual-playwright-injected.d.ts'),
        );
      },
    },
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        vite: resolve(__dirname, 'src/vite.ts'),
      },
      formats: ['es'],
    },
    outDir: 'dist',
    rollupOptions: {
      external: (id: string) => id.startsWith('node:') || id === 'vite',
    },
  },
});

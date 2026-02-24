# playwright-injected

[![npm version](https://img.shields.io/npm/v/playwright-injected.svg)](https://www.npmjs.com/package/playwright-injected)
[![npm downloads](https://img.shields.io/npm/dm/playwright-injected.svg)](https://www.npmjs.com/package/playwright-injected)

Playwright's browser-side engine extracted as a standalone module. Includes the InjectedScript (selector engine, element querying, state checking), locator conversion utilities, accessibility/ARIA utilities, and DOM helpers. This is the exact code that powers `playwright codegen` and the trace viewer.

## Why

Playwright's locator generation, ARIA snapshots, and DOM inspection are all internal — there's no public API to use them, and no way to run them in the browser. This package extracts them as a standalone module you can import and call directly, in the browser without Playwright installed.

## Install

```bash
npm install playwright-injected
```

No runtime dependencies. Everything is pre-bundled from Playwright's source at build time using esbuild.

> **Stability warning:** This package exposes Playwright's internal APIs which are not part of Playwright's public contract and may change without notice between Playwright versions. Pin your version and test after upgrading. The core concepts (InjectedScript, selector generation, locator conversion) have been stable for years, but individual function signatures, types, and internal selector formats may shift.

## Usage

```js
import {
  InjectedScript,
  asLocator,
  locatorOrSelectorAsSelector,
  getByRoleSelector,
  parseSelector,
  getAriaRole,
  getElementAccessibleName,
  isElementVisible,
} from 'playwright-injected';

// --- Setup (once per page) ---

const injected = new InjectedScript(window, {
  isUnderTest: false,
  sdkLanguage: 'javascript',
  testIdAttributeName: 'data-testid',
  stableRafCount: 0,
  browserName: 'chromium',
  customEngines: [],
});

// --- Generate a selector from a DOM element ---

const el = document.querySelector('button');
const { selector, selectors } = injected.generateSelector(el);
// selector  => 'internal:role=button[name="Submit"i]'
// selectors => ['internal:role=button[name="Submit"i]', '#submit-btn', ...]

// --- Convert selectors <-> locator strings ---

asLocator('javascript', selector);
// => "getByRole('button', { name: 'Submit' })"

asLocator('python', selector);
// => "get_by_role('button', name='Submit')"

locatorOrSelectorAsSelector('javascript', "getByText('hello')", 'data-testid');
// => 'internal:text="hello"i'

// --- Build selectors programmatically ---

getByRoleSelector('button', { name: 'Submit' });
// => 'internal:role=button[name="Submit"i]'

// --- Query elements from a selector ---

const parsed = injected.parseSelector(selector);
const matches = injected.querySelectorAll(parsed, document);

// --- Element state ---

injected.elementState(el, 'visible'); // { matches: true, received: 'visible' }
injected.elementState(el, 'enabled'); // { matches: true, received: 'enabled' }

// --- Accessibility ---

getAriaRole(el); // 'button'
getElementAccessibleName(el, false); // 'Submit'
isElementVisible(el); // true
injected.ariaSnapshot(el, { mode: 'ai' });
// => '- button "Submit" [ref=e1]'

// --- Parse a selector into its AST ---

parseSelector('internal:role=button[name="OK"i]');
// => { parts: [{ name: 'internal:role', body: 'button[name="OK"i]', source: '...' }] }
```

See `app/playwright-helpers.ts` for a more complete usage example showing how to build an element inspector on top of the library.

## Vite plugin (advanced)

> Most users should use the main `playwright-injected` import above — it's pre-bundled and works out of the box with no extra setup. The Vite plugin is only needed if you want to pin to a specific `playwright-core` version you already have installed and bundle directly from its source:

```ts
// vite.config.ts
import playwrightInjected from 'playwright-injected/vite';

export default defineConfig({
  plugins: [playwrightInjected()],
});
```

The plugin provides:

- **`virtual:playwright-injected`** -- the InjectedScript as an ES module
- **`@playwright-isomorphic/*`** -- Playwright's isomorphic utilities

```ts
import { InjectedScript } from 'virtual:playwright-injected';
import { asLocator } from '@playwright-isomorphic/locatorGenerators';
```

**TypeScript:** Add the type declarations via a triple-slash reference or in `tsconfig.json`:

```ts
/// <reference types="playwright-injected/virtual-playwright-injected" />
```

## Development

### Setup

```bash
git clone https://github.com/kolodny/playwright-injected.git
cd playwright-injected
npm install
npm run sync   # clones playwright, bundles source into src/generated/
npm run build  # packages src/generated/ into dist/
```

### Syncing with Playwright

`npm run sync` clones the playwright repo on first run, then builds everything into `src/generated/`. To update to a new Playwright version:

```bash
cd playwright
git fetch && git checkout v1.XX.X   # or main
cd ..
npm run sync
npm run build
```

## How it works

The build clones the [Playwright](https://github.com/microsoft/playwright) repo and uses esbuild to bundle Playwright's browser-side internals into a single zero-dependency ESM bundle. Types are generated with `tsc --declaration`.

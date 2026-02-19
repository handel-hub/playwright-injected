/**
 * Thin helpers around the playwright-injected library.
 * This file shows how to use the library — no React, no UI, just the API.
 */

import {
  InjectedScript,
  asLocator,
  parseSelector,
  locatorOrSelectorAsSelector,
  getByRoleSelector,
  getByTextSelector,
  getByTestIdSelector,
  getAriaRole,
  getElementAccessibleName,
  getElementAccessibleDescription,
  getAriaChecked,
  getAriaDisabled,
  getAriaExpanded,
  isElementVisible,
  isElementHiddenForAria,
  type Language,
} from '../src';

// --- Create a shared InjectedScript instance ---

export const injected = new InjectedScript(window, {
  isUnderTest: false,
  sdkLanguage: 'javascript',
  testIdAttributeName: 'data-testid',
  stableRafCount: 0,
  browserName: 'chromium',
  customEngines: [],
});

// --- Selector generation ---

export function generateSelector(element: Element) {
  return injected.generateSelector(element, {
    testIdAttributeName: 'data-testid',
    multiple: true,
  });
}

// --- Element querying ---

export function queryBySelector(selector: string): Element[] {
  const parsed = injected.parseSelector(selector);
  return injected.querySelectorAll(parsed, document);
}

// --- Locator conversion ---

export { asLocator, parseSelector, locatorOrSelectorAsSelector };
export type { Language };

// --- Selector builders ---

export { getByRoleSelector, getByTextSelector, getByTestIdSelector };

// Example:
// getByRoleSelector('button', { name: 'Submit' })
//   => 'internal:role=button[name="Submit"i]'
// getByTextSelector('hello')
//   => 'internal:text="hello"i'

// --- Locator to selector (reverse conversion) ---

export function locatorToSelector(
  locator: string,
  lang: Language = 'javascript',
): string {
  return locatorOrSelectorAsSelector(lang, locator, 'data-testid');
}

// Example:
// locatorToSelector("getByRole('button', { name: 'OK' })")
//   => 'internal:role=button[name="OK"i]'

export const LANG_LABELS: Partial<Record<Language, string>> = {
  javascript: 'JavaScript',
  python: 'Python',
  java: 'Java',
  csharp: 'C#',
};
export const LANGS = Object.keys(LANG_LABELS) as Language[];

// --- Accessibility inspection ---

export function inspectElement(el: Element) {
  return {
    preview: injected.previewNode(el),
    role: getAriaRole(el) || '(none)',
    name: getElementAccessibleName(el, false) || '(none)',
    description: getElementAccessibleDescription(el, false) || '(none)',
    visible: isElementVisible(el),
    hiddenForAria: isElementHiddenForAria(el),
    checked: getAriaChecked(el),
    disabled: getAriaDisabled(el),
    expanded: getAriaExpanded(el),
  };
}

// --- Element state ---

export function getElementState(el: Element) {
  return {
    visible: injected.elementState(el, 'visible'),
    enabled: injected.elementState(el, 'enabled'),
    checked: injected.elementState(el, 'checked'),
    editable: injected.elementState(el, 'editable'),
  };
}

// --- Element interaction ---

export function fillElement(el: Element, value: string) {
  return injected.fill(el, value);
}

export function focusElement(el: Element) {
  return injected.focusNode(el);
}

export function clickElement(el: Element) {
  injected.dispatchEvent(el, 'click', {});
}

// --- Aria snapshots ---

export function getAriaSnapshot(el: Element): string {
  return injected.ariaSnapshot(el, { mode: 'ai' });
}

export function resolveAriaRef(refId: string): Element | undefined {
  const parsed = injected.parseSelector(`aria-ref=${refId}`);
  return injected.querySelectorAll(parsed, document)[0];
}

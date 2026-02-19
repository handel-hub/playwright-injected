import React, { useState, useCallback, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  generateSelector,
  queryBySelector,
  inspectElement,
  getAriaSnapshot,
  resolveAriaRef,
  asLocator,
  parseSelector,
  locatorToSelector,
  LANGS,
  LANG_LABELS,
} from './playwright-helpers';

let anchorCounter = 0;

function createHighlightOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.pointerEvents = 'none';
  overlay.style.border = '2px solid #4a90d9';
  overlay.style.background = 'rgba(74,144,217,0.1)';
  overlay.style.zIndex = '999999';
  overlay.style.display = 'none';
  document.body.appendChild(overlay);
  return overlay;
}

function updateHighlight(overlay: HTMLDivElement, el: Element): void {
  const anchorName = `--highlight-${++anchorCounter}`;
  (el as HTMLElement).style.setProperty('anchor-name', anchorName);
  overlay.style.setProperty('position-anchor', anchorName);
  overlay.style.setProperty('top', 'anchor(top)');
  overlay.style.setProperty('left', 'anchor(left)');
  overlay.style.setProperty('width', 'anchor-size(width)');
  overlay.style.setProperty('height', 'anchor-size(height)');
  overlay.style.display = 'block';
  (overlay as any)._anchoredElement = el;
}

function hideHighlight(overlay: HTMLDivElement): void {
  overlay.style.display = 'none';
  const el = (overlay as any)._anchoredElement as HTMLElement | undefined;
  if (el) {
    el.style.removeProperty('anchor-name');
    (overlay as any)._anchoredElement = undefined;
  }
}

const mono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 13 };
const selectedOverlay = createHighlightOverlay();

const App: React.FC = () => {
  const [picking, setPicking] = useState(false);
  const [selector, setSelector] = useState('');
  const [selectorInput, setSelectorInput] = useState('');
  const [altSelectors, setAltSelectors] = useState<string[]>([]);

  const handlePick = useCallback(() => {
    setSelector('');
    setSelectorInput('');
    setAltSelectors([]);
    hideHighlight(selectedOverlay);
    setPicking(true);
  }, []);

  const selectElement = useCallback((el: Element) => {
    const result = generateSelector(el);
    setSelector(result.selector);
    setSelectorInput(result.selector);
    setAltSelectors(
      result.selectors.filter((s: string) => s !== result.selector),
    );
  }, []);

  // Picking mode: hover overlay + click to select
  useEffect(() => {
    if (!picking) return;

    const hoverOverlay = createHighlightOverlay();

    const onMove = (e: MouseEvent) => {
      const target = e.target as Element;
      if (target.closest('#demo-controls') || target === hoverOverlay) return;
      updateHighlight(hoverOverlay, target);
    };

    const onClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as Element;
      if (target.closest('#demo-controls') || target === hoverOverlay) return;
      selectElement(target);
      setPicking(false);
    };

    document.addEventListener('mousemove', onMove, { capture: true });
    document.addEventListener('click', onClick, { capture: true, once: true });
    return () => {
      document.removeEventListener('mousemove', onMove, { capture: true });
      document.removeEventListener('click', onClick, { capture: true });
      hoverOverlay.remove();
    };
  }, [picking, selectElement]);

  // Query matched elements
  let matchedElements: Element[] = [];
  if (selector) {
    try {
      matchedElements = queryBySelector(selector);
    } catch {}
  }

  // Keep the selected overlay in sync
  useEffect(() => {
    if (matchedElements.length) {
      updateHighlight(selectedOverlay, matchedElements[0]);
    } else {
      hideHighlight(selectedOverlay);
    }
    return () => hideHighlight(selectedOverlay);
  }, [selector]);

  const el = matchedElements[0];
  const info = el ? inspectElement(el) : null;

  return (
    <div
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: '12px 24px',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      <h1>playwright-injected demo</h1>

      <div style={{ padding: 12, border: '2px dashed #ccc', borderRadius: 8 }}>
        <h2>Sample Content</h2>
        <p>Use the picker below to inspect these elements:</p>
        <form
          id="login-form"
          onSubmit={(e) => e.preventDefault()}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            maxWidth: 400,
          }}
        >
          <label>
            Email
            <input
              id="email"
              type="email"
              className="form-input"
              placeholder="user@example.com"
              title="Enter your email"
            />
          </label>
          <label>
            Password
            <input
              id="password"
              type="password"
              className="form-input"
              placeholder="Enter password"
              title="Enter your password"
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" id="remember" /> Remember me
          </label>
          <textarea
            id="notes"
            placeholder="Additional notes"
            title="Extra notes"
            aria-label="Notes"
            rows={2}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="submit"
              id="submit-btn"
              className="btn primary"
              title="Submit the form"
            >
              Sign In
            </button>
            <button type="button" className="btn" title="Cancel and reset">
              Cancel
            </button>
          </div>
        </form>
        <div
          style={{
            marginTop: 12,
            padding: 8,
            background: '#f0f0f0',
            borderRadius: 4,
          }}
          role="status"
          aria-label="Login status"
        >
          <span id="status-text">Not signed in</span>
        </div>
        <nav style={{ marginTop: 12 }}>
          <a href="#" id="nav-home" title="Go to homepage">
            Home
          </a>{' '}
          |{' '}
          <a href="#" title="About us">
            About
          </a>{' '}
          |{' '}
          <a href="#" title="Contact us">
            Contact
          </a>
        </nav>
        <img
          src=""
          alt="Company Logo"
          title="Our logo"
          id="logo"
          width={100}
          height={30}
          style={{ marginTop: 8, background: '#ddd', display: 'block' }}
        />
        <ul style={{ marginTop: 8 }}>
          <li>First item</li>
          <li>Second item</li>
          <li>Third item</li>
        </ul>
      </div>

      <div id="demo-controls" style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={handlePick}
            style={{ fontSize: 14, padding: '6px 16px' }}
          >
            {picking ? '... click an element ...' : 'Pick Element'}
          </button>
          <span>or</span>
          <input
            value={selectorInput}
            onChange={(e) => {
              const input = e.target.value;
              setSelectorInput(input);
              // Try as locator first, fall back to raw selector
              const parsed = locatorToSelector(input);
              setSelector(parsed || input);
              setAltSelectors([]);
            }}
            style={{
              flex: 1,
              fontSize: 13,
              padding: '6px 8px',
              fontFamily: 'monospace',
            }}
            placeholder="getByRole('button', { name: 'Submit' }) or internal:role=button[name=&quot;Submit&quot;i]"
          />
        </div>

        {selector && (
          <div style={{ marginTop: 8 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                <tr>
                  <td
                    style={{
                      padding: '3px 8px 3px 0',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'top',
                    }}
                  >
                    Selector
                  </td>
                  <td style={{ padding: 3, ...mono, wordBreak: 'break-all' }}>
                    {selector}
                  </td>
                </tr>
                <tr>
                  <td
                    style={{
                      padding: '3px 8px 3px 0',
                      fontWeight: 'bold',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'top',
                    }}
                  >
                    Matches
                  </td>
                  <td style={{ padding: 3 }}>
                    {matchedElements.length} element(s)
                  </td>
                </tr>
                {LANGS.map((lang) => (
                  <tr key={lang}>
                    <td
                      style={{
                        padding: '3px 8px 3px 0',
                        fontWeight: 'bold',
                        whiteSpace: 'nowrap',
                        verticalAlign: 'top',
                      }}
                    >
                      {LANG_LABELS[lang]}
                    </td>
                    <td style={{ padding: 3, ...mono, wordBreak: 'break-all' }}>
                      {asLocator(lang, selector)}
                    </td>
                  </tr>
                ))}
                {info && (
                  <>
                    {[
                      ['Preview', info.preview],
                      ['Role', info.role],
                      ['Name', info.name],
                      ['Description', info.description],
                      ['Visible', String(info.visible)],
                      ['Hidden for ARIA', String(info.hiddenForAria)],
                      ['Checked', String(info.checked)],
                      ['Disabled', String(info.disabled)],
                      ['Expanded', String(info.expanded)],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <td
                          style={{
                            padding: '3px 8px 3px 0',
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap',
                            verticalAlign: 'top',
                          }}
                        >
                          {label}
                        </td>
                        <td
                          style={{
                            padding: 3,
                            ...mono,
                            wordBreak:
                              label === 'Preview' ? 'break-all' : undefined,
                          }}
                        >
                          {value}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>

            {altSelectors.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: 'pointer' }}>
                  Alternative selectors ({altSelectors.length})
                </summary>
                <ol style={{ marginTop: 4 }}>
                  {altSelectors.map((alt, i) => (
                    <li
                      key={i}
                      style={{
                        ...mono,
                        marginBottom: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <span>{alt}</span>
                      <button
                        style={{
                          fontSize: 11,
                          padding: '1px 6px',
                          cursor: 'pointer',
                        }}
                        onClick={() => {
                          setSelector(alt);
                          setSelectorInput(alt);
                          setAltSelectors([]);
                        }}
                      >
                        use instead
                      </button>
                    </li>
                  ))}
                </ol>
              </details>
            )}

            {el &&
              (() => {
                const snapshot = getAriaSnapshot(el);
                const parts = snapshot.split(/(\[ref=\w+\])/g);

                return (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer' }}>
                      Aria snapshot
                    </summary>
                    <pre
                      style={{
                        ...mono,
                        marginTop: 4,
                        padding: 8,
                        background: '#f5f5f5',
                        borderRadius: 4,
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {parts.map((part, i) => {
                        const refMatch = part.match(/^\[ref=(\w+)\]$/);
                        if (!refMatch) return part;
                        const refId = refMatch[1];
                        return (
                          <span
                            key={i}
                            style={{
                              color: '#4a90d9',
                              cursor: 'pointer',
                              textDecoration: 'underline',
                            }}
                            onClick={() => {
                              const refEl = resolveAriaRef(refId);
                              if (refEl) selectElement(refEl);
                            }}
                          >
                            {part}
                          </span>
                        );
                      })}
                    </pre>
                  </details>
                );
              })()}

            <details style={{ marginTop: 6 }}>
              <summary style={{ cursor: 'pointer' }}>Parsed selector</summary>
              <pre
                style={{
                  ...mono,
                  marginTop: 4,
                  padding: 8,
                  background: '#f5f5f5',
                  borderRadius: 4,
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(parseSelector(selector), null, 2)}
              </pre>
            </details>
          </div>
        )}
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

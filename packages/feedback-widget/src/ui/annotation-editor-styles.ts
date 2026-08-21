/**
 * The editor's own stylesheet, injected into the shadow root when the editor
 * opens and removed when it closes (PULSE-401).
 *
 * These rules used to live in `ui/styles.ts`, which the embed carries on every
 * page view of every client site — bytes for a surface most reporters never
 * open. They travel with the lazily fetched editor instead, which is also why
 * the palette is repeated here rather than imported from `ui/styles.ts`:
 * importing it would pull the whole embed stylesheet into this artefact.
 */

interface EditorColors {
  bg: string
  text: string
  border: string
  muted: string
  primary: string
  primaryHover: string
  inputBg: string
}

const light: EditorColors = {
  bg: '#ffffff',
  text: '#1a1a2e',
  border: '#e5e5e5',
  muted: '#6b7280',
  primary: '#5e6ad2',
  primaryHover: '#4f59b5',
  inputBg: '#f9fafb',
}

const dark: EditorColors = {
  bg: '#1a1a2e',
  text: '#e5e5e5',
  border: '#2d2d44',
  muted: '#9ca3af',
  primary: '#5e6ad2',
  primaryHover: '#6e7be0',
  inputBg: '#242444',
}

export function editorStyles(theme: 'light' | 'dark'): string {
  const c = theme === 'dark' ? dark : light

  return `
    /* The widget host goes full-screen only while the editor is open. */
    :host(.pulse-annotating) {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      width: 100vw !important;
      height: 100vh !important;
    }

    .pulse-annotation {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0,0,0,0.6);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .pulse-annotation__toolbar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      justify-content: center;
      gap: 4px;
      padding: 6px 8px;
      max-width: min(94vw, 1100px);
      background: ${c.bg};
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      margin-bottom: 12px;
    }

    .pulse-annotation__group {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .pulse-annotation__divider {
      width: 1px;
      height: 24px;
      background: ${c.border};
      margin: 0 4px;
    }

    .pulse-annotation__tool-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: ${c.muted};
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
      outline: none;
    }

    .pulse-annotation__tool-btn:hover:not(:disabled) {
      background: ${c.inputBg};
      color: ${c.text};
    }

    .pulse-annotation__tool-btn:focus-visible {
      box-shadow: 0 0 0 2px ${c.primary}66;
    }

    .pulse-annotation__tool-btn:disabled {
      opacity: 0.35;
      cursor: default;
    }

    .pulse-annotation__tool-btn--active {
      background: ${c.primary}1a;
      color: ${c.primary};
    }

    .pulse-annotation__tool-btn svg {
      width: 16px;
      height: 16px;
    }

    .pulse-annotation__action-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: ${c.muted};
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
      outline: none;
    }

    .pulse-annotation__action-btn:hover {
      background: ${c.inputBg};
      color: ${c.text};
    }

    .pulse-annotation__action-btn--primary {
      background: ${c.primary};
      color: #ffffff;
    }

    .pulse-annotation__action-btn--primary:hover {
      background: ${c.primaryHover};
      color: #ffffff;
    }

    /* The bitmap keeps its native pixels; only CSS scales it to fit the viewport. */
    .pulse-annotation__canvas-wrap {
      position: relative;
      max-width: min(92vw, 1100px);
      max-height: 76vh;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      cursor: crosshair;
      background: #ffffff;
      touch-action: none;
    }

    .pulse-annotation__canvas-wrap--select {
      cursor: default;
    }

    .pulse-annotation__canvas-wrap canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .pulse-annotation__layer {
      position: absolute;
      inset: 0;
    }
  `
}

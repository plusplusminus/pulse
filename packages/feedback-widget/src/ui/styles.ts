interface ThemeColors {
  bg: string
  text: string
  border: string
  muted: string
  primary: string
  primaryHover: string
  success: string
  error: string
  inputBg: string
}

const lightColors: ThemeColors = {
  bg: '#ffffff',
  text: '#1a1a2e',
  border: '#e5e5e5',
  muted: '#6b7280',
  primary: '#5e6ad2',
  primaryHover: '#4f59b5',
  success: '#22c55e',
  error: '#ef4444',
  inputBg: '#f9fafb',
}

const darkColors: ThemeColors = {
  bg: '#1a1a2e',
  text: '#e5e5e5',
  border: '#2d2d44',
  muted: '#9ca3af',
  primary: '#5e6ad2',
  primaryHover: '#6e7be0',
  success: '#22c55e',
  error: '#ef4444',
  inputBg: '#242444',
}

export function getWidgetStyles(theme: 'light' | 'dark'): string {
  const c = theme === 'dark' ? darkColors : lightColors

  return `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: ${c.text};
    }

    :host(.pulse-annotating) {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      width: 100vw !important;
      height: 100vh !important;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* Trigger button */
    .pulse-trigger {
      position: fixed;
      bottom: 20px;
      z-index: 2147483647;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      background: ${c.primary};
      color: #ffffff;
      border: none;
      border-radius: 100px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08);
      transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
      outline: none;
      line-height: 1;
    }

    .pulse-trigger:hover {
      transform: scale(1.04);
      box-shadow: 0 2px 8px rgba(0,0,0,0.15), 0 8px 24px rgba(0,0,0,0.12);
      background: ${c.primaryHover};
    }

    .pulse-trigger:active {
      transform: scale(0.98);
    }

    .pulse-trigger:focus-visible {
      box-shadow: 0 0 0 2px ${c.bg}, 0 0 0 4px ${c.primary};
    }

    .pulse-trigger--right { right: 20px; }
    .pulse-trigger--left { left: 20px; }

    .pulse-trigger svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }

    /* Panel */
    .pulse-panel {
      position: fixed;
      bottom: 72px;
      z-index: 2147483647;
      width: 360px;
      max-height: calc(100vh - 100px);
      background: ${c.bg};
      border: 1px solid ${c.border};
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 10px 30px -5px rgba(0,0,0,0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translateY(8px) scale(0.98);
      transition: opacity 0.2s ease, transform 0.2s ease;
      pointer-events: none;
    }

    .pulse-panel--visible {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    .pulse-panel--right { right: 20px; }
    .pulse-panel--left { left: 20px; }

    /* Header */
    .pulse-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid ${c.border};
    }

    .pulse-header__title {
      font-size: 14px;
      font-weight: 600;
      color: ${c.text};
    }

    .pulse-header__close {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: ${c.muted};
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
      outline: none;
    }

    .pulse-header__close:hover {
      background: ${c.inputBg};
      color: ${c.text};
    }

    .pulse-header__close:focus-visible {
      box-shadow: 0 0 0 2px ${c.primary};
    }

    .pulse-header__close svg {
      width: 16px;
      height: 16px;
    }

    /* Body */
    .pulse-body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    /* Type selector */
    .pulse-types {
      display: flex;
      gap: 6px;
      margin-bottom: 14px;
    }

    .pulse-type-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 7px 10px;
      border: 1px solid ${c.border};
      border-radius: 8px;
      background: transparent;
      color: ${c.muted};
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;
      outline: none;
    }

    .pulse-type-btn:hover {
      border-color: ${c.primary};
      color: ${c.text};
    }

    .pulse-type-btn--active {
      background: ${c.primary}14;
      border-color: ${c.primary};
      color: ${c.primary};
    }

    .pulse-type-btn:focus-visible {
      box-shadow: 0 0 0 2px ${c.primary};
    }

    .pulse-type-btn svg {
      width: 14px;
      height: 14px;
    }

    /* Form fields */
    .pulse-field {
      margin-bottom: 12px;
    }

    .pulse-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: ${c.text};
      margin-bottom: 4px;
    }

    .pulse-label--required::after {
      content: ' *';
      color: ${c.error};
    }

    .pulse-input,
    .pulse-textarea {
      width: 100%;
      padding: 8px 10px;
      background: ${c.inputBg};
      border: 1px solid ${c.border};
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      color: ${c.text};
      outline: none;
      transition: border-color 0.12s ease, box-shadow 0.12s ease;
    }

    .pulse-input::placeholder,
    .pulse-textarea::placeholder {
      color: ${c.muted};
    }

    .pulse-input:focus,
    .pulse-textarea:focus {
      border-color: ${c.primary};
      box-shadow: 0 0 0 3px ${c.primary}1a;
    }

    .pulse-textarea {
      resize: vertical;
      min-height: 64px;
    }

    .pulse-input--error,
    .pulse-textarea--error {
      border-color: ${c.error};
    }

    .pulse-field-error {
      font-size: 11px;
      color: ${c.error};
      margin-top: 3px;
    }

    /* Screenshot preview */
    .pulse-screenshot {
      margin-bottom: 12px;
      border: 1px solid ${c.border};
      border-radius: 8px;
      overflow: hidden;
    }

    .pulse-screenshot__img {
      width: 100%;
      display: block;
      max-height: 140px;
      object-fit: cover;
    }

    .pulse-screenshot__actions {
      display: flex;
      gap: 0;
      border-top: 1px solid ${c.border};
    }

    .pulse-screenshot__btn {
      flex: 1;
      padding: 6px 8px;
      border: none;
      background: transparent;
      color: ${c.muted};
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s ease, color 0.12s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }

    .pulse-screenshot__btn:hover {
      background: ${c.inputBg};
      color: ${c.text};
    }

    .pulse-screenshot__btn + .pulse-screenshot__btn {
      border-left: 1px solid ${c.border};
    }

    .pulse-screenshot__btn--danger:hover {
      color: ${c.error};
    }

    .pulse-header__pause {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      margin-left: auto;
      margin-right: 4px;
      padding: 0;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: ${c.muted};
      cursor: pointer;
    }

    .pulse-header__pause svg {
      width: 14px;
      height: 14px;
    }

    .pulse-header__pause:hover {
      background: ${c.inputBg};
      color: ${c.text};
    }

    .pulse-header__pause--active {
      background: ${c.primary}1f;
      color: ${c.primary};
    }

    /* Screenshot option buttons */
    .pulse-screenshot-options {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }

    .pulse-capture-note {
      font-size: 11px;
      line-height: 1.4;
      color: ${c.muted};
    }

    .pulse-capture-note--error {
      color: ${c.error};
    }

    .pulse-add-screenshot {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 10px 8px;
      border: 1px dashed ${c.border};
      border-radius: 8px;
      background: transparent;
      color: ${c.muted};
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
    }

    .pulse-add-screenshot:hover {
      border-color: ${c.primary};
      color: ${c.primary};
      background: ${c.inputBg};
    }

    .pulse-add-screenshot svg {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }

    /* Submit button */
    .pulse-submit {
      width: 100%;
      padding: 9px 16px;
      background: ${c.primary};
      color: #ffffff;
      border: none;
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s ease, opacity 0.12s ease;
      outline: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }

    .pulse-submit:hover:not(:disabled) {
      background: ${c.primaryHover};
    }

    .pulse-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .pulse-submit:focus-visible {
      box-shadow: 0 0 0 2px ${c.bg}, 0 0 0 4px ${c.primary};
    }

    /* Spinner */
    .pulse-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: pulse-spin 0.6s linear infinite;
    }

    .pulse-spinner--dark {
      border-color: ${c.border};
      border-top-color: ${c.primary};
    }

    @keyframes pulse-spin {
      to { transform: rotate(360deg); }
    }

    /* Footer */
    .pulse-footer {
      padding: 10px 16px;
      border-top: 1px solid ${c.border};
      text-align: center;
    }

    .pulse-footer__text {
      font-size: 11px;
      color: ${c.muted};
    }

    .pulse-footer__info {
      font-size: 10px;
      color: ${c.muted};
      margin-top: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }

    .pulse-footer__info svg {
      width: 12px;
      height: 12px;
    }

    /* Status screens */
    .pulse-status {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
      text-align: center;
      gap: 12px;
    }

    .pulse-status__icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .pulse-status__icon--success {
      background: ${c.success}1a;
      color: ${c.success};
    }

    .pulse-status__icon--error {
      background: ${c.error}1a;
      color: ${c.error};
    }

    .pulse-status__icon svg {
      width: 24px;
      height: 24px;
    }

    .pulse-status__title {
      font-size: 15px;
      font-weight: 600;
      color: ${c.text};
    }

    .pulse-status__message {
      font-size: 13px;
      color: ${c.muted};
      max-width: 240px;
    }

    .pulse-status__link {
      font-size: 12px;
      color: ${c.primary};
      text-decoration: none;
    }

    .pulse-status__link:hover {
      text-decoration: underline;
    }

    .pulse-status__btn {
      padding: 8px 20px;
      border-radius: 8px;
      border: 1px solid ${c.border};
      background: transparent;
      color: ${c.text};
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s ease;
      margin-top: 4px;
    }

    .pulse-status__btn:hover {
      background: ${c.inputBg};
    }

    /* Capturing overlay */
    .pulse-capturing {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 16px;
      gap: 12px;
    }

    .pulse-capturing__text {
      font-size: 13px;
      color: ${c.muted};
    }

    /* Annotation canvas */
    .pulse-annotation {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0,0,0,0.6);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
    }

    .pulse-annotation__toolbar {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 8px;
      background: ${c.bg};
      border-radius: 10px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      margin-bottom: 12px;
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

    .pulse-annotation__tool-btn:hover {
      background: ${c.inputBg};
      color: ${c.text};
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

    .pulse-annotation__canvas-wrap canvas {
      display: block;
      width: 100%;
      height: 100%;
    }

    .pulse-annotation__layer {
      position: absolute;
      inset: 0;
    }

    /* Element pick: hover overlay + label (pointer-events none so the page stays hittable) */
    .pulse-pick-overlay {
      position: fixed;
      z-index: 2147483646;
      pointer-events: none;
      box-sizing: border-box;
      border: 2px solid ${c.primary};
      background: ${c.primary}14;
      border-radius: 3px;
      display: none;
      transition: left 0.04s linear, top 0.04s linear, width 0.04s linear, height 0.04s linear;
    }

    .pulse-pick-label {
      position: absolute;
      left: -2px;
      bottom: 100%;
      margin-bottom: 4px;
      max-width: 260px;
      padding: 2px 7px;
      background: ${c.primary};
      color: #ffffff;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.5;
      border-radius: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pulse-pick-label--below {
      bottom: auto;
      top: 100%;
      margin-bottom: 0;
      margin-top: 4px;
    }

    /* Numbered markers for committed picks */
    .pulse-markers {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
    }

    .pulse-marker {
      position: absolute;
      width: 22px;
      height: 22px;
      margin: -11px 0 0 -11px;
      border-radius: 50%;
      background: ${c.primary};
      color: #ffffff;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 0 2px ${c.bg}, 0 2px 6px rgba(0,0,0,0.25);
    }

    .pulse-marker--pending {
      background: ${c.primaryHover};
      opacity: 0.85;
    }

    /* Multi-select: outline per pending element + a live status pill */
    .pulse-outlines {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      pointer-events: none;
    }

    .pulse-outline {
      position: absolute;
      box-sizing: border-box;
      border: 2px dashed ${c.primary};
      background: ${c.primary}1f;
      border-radius: 3px;
    }

    .pulse-outline__badge {
      position: absolute;
      top: -9px;
      left: -9px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: ${c.primary};
      color: #ffffff;
      font-size: 10px;
      font-weight: 600;
      line-height: 18px;
      text-align: center;
    }

    /* Drag area-select rectangle */
    .pulse-marquee {
      position: fixed;
      z-index: 2147483646;
      box-sizing: border-box;
      border: 1px solid ${c.primary};
      background: ${c.primary}1a;
      border-radius: 2px;
      pointer-events: none;
    }

    .pulse-pick-status {
      position: fixed;
      z-index: 2147483647;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      padding: 6px 12px;
      background: ${c.text};
      color: ${c.bg};
      font-size: 12px;
      font-weight: 500;
      border-radius: 999px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.25);
      pointer-events: none;
      white-space: nowrap;
    }

    /* Comment + intent popup */
    .pulse-pick-popup {
      position: fixed;
      z-index: 2147483647;
      width: 280px;
      transform: translateX(-50%);
      padding: 12px;
      background: ${c.bg};
      color: ${c.text};
      border: 1px solid ${c.border};
      border-radius: 10px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 10px 30px -5px rgba(0,0,0,0.2);
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .pulse-pick-popup__title {
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pulse-pick-popup__intents {
      display: flex;
      gap: 4px;
    }

    .pulse-pick-popup__intent {
      flex: 1;
      padding: 4px 0;
      border: 1px solid ${c.border};
      border-radius: 6px;
      background: transparent;
      color: ${c.muted};
      font-family: inherit;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s ease;
    }

    .pulse-pick-popup__intent:hover {
      border-color: ${c.primary};
      color: ${c.text};
    }

    .pulse-pick-popup__intent--active {
      background: ${c.primary}14;
      border-color: ${c.primary};
      color: ${c.primary};
    }

    .pulse-pick-popup__comment {
      min-height: 56px;
    }

    .pulse-pick-popup__actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
    }

    .pulse-pick-popup__btn {
      padding: 5px 10px;
      border: 1px solid ${c.border};
      border-radius: 6px;
      background: transparent;
      color: ${c.text};
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }

    .pulse-pick-popup__btn:hover {
      background: ${c.inputBg};
    }

    .pulse-pick-popup__btn--primary {
      background: ${c.primary};
      border-color: ${c.primary};
      color: #ffffff;
    }

    .pulse-pick-popup__btn--primary:hover {
      background: ${c.primaryHover};
    }

    /* Picks list in the panel */
    .pulse-picks {
      margin-bottom: 12px;
    }

    .pulse-picks__list {
      list-style: none;
      margin: 0 0 8px;
      border: 1px solid ${c.border};
      border-radius: 8px;
      overflow: hidden;
    }

    .pulse-picks__row {
      padding: 7px 10px;
      font-size: 12px;
    }

    .pulse-picks__row + .pulse-picks__row {
      border-top: 1px solid ${c.border};
    }

    .pulse-picks__main {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }

    .pulse-picks__name {
      flex: 1;
      min-width: 0;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .pulse-picks__intent {
      flex-shrink: 0;
      padding: 1px 6px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      text-transform: capitalize;
      background: ${c.primary}14;
      color: ${c.primary};
    }

    .pulse-picks__intent--question { background: #f59e0b1f; color: #b45309; }
    .pulse-picks__intent--approve { background: ${c.success}1f; color: ${c.success}; }
    .pulse-picks__intent--change { background: #0ea5e91f; color: #0369a1; }

    .pulse-picks__action {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      padding: 0;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: ${c.muted};
      cursor: pointer;
    }

    .pulse-picks__action svg {
      width: 13px;
      height: 13px;
    }

    .pulse-picks__action:hover {
      background: ${c.inputBg};
      color: ${c.text};
    }

    .pulse-picks__action--delete:hover {
      color: ${c.error};
    }

    .pulse-picks__comment {
      margin-top: 2px;
      color: ${c.muted};
      font-size: 11px;
    }

    .pulse-pick-btn {
      width: 100%;
    }
  `
}

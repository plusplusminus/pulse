/**
 * Pure DOM helpers for element-pick (PULSE-328).
 *
 * Two families of output:
 *  - human-readable identity for the Linear body (`getElementPath`, `identifyElement`,
 *    `getElementClasses`, `getNearbyText`, `getNearbyElements`, computed styles, a11y);
 *  - machine-relocatable identity (`getUniqueSelector` via @medv/finder, `getXPath`,
 *    `getRelocationHints`) so a later consumer can find the element again.
 *
 * Conventions:
 *  - `isMeaningfulClass` is the single predicate for "is this class worth showing".
 *  - Paths truncated by depth are prefixed with `… > ` (never silently cut).
 *  - Crossing a shadow boundary marks the topmost in-shadow node with `⟨shadow⟩`;
 *    selectors/XPaths cross it with ` >>> `.
 *
 * Detailed computed-style property set (getDetailedComputedStyles): display, position,
 * width, height, margin, padding, border, border-radius, background-color, color,
 * font-size, font-weight, font-family, line-height, text-align, opacity, z-index,
 * overflow, flex-direction, gap, justify-content, align-items, grid-template-columns,
 * box-shadow, cursor. Values equal to a generic default (none / auto / 0px / transparent /
 * normal / static / visible / rgba(0, 0, 0, 0)) or to the tag's own default are skipped.
 */
import { finder } from '@medv/finder'

export const PATH_MAX_DEPTH = 4
export const TRUNCATED_PREFIX = '… > '
export const SHADOW_PREFIX = '⟨shadow⟩'
export const SHADOW_SEPARATOR = ' >>> '

// -- classes ---------------------------------------------------------------

const CSS_MODULE_HASH = /^([a-zA-Z][a-zA-Z0-9_-]*?)(_[a-zA-Z0-9]{5,})?$/

/** Canonical "meaningful class" predicate: not tiny, not a 1-2 letter utility, not hash-like. */
export function isMeaningfulClass(c: string): boolean {
  return c.length > 2 && !/^[a-z]{1,2}$/.test(c) && !/[A-Z0-9]{5,}/.test(c)
}

/** Strips a CSS-module style `_hash` suffix (`button_a1b2c3` -> `button`). */
export function stripClassHash(c: string): string {
  const m = CSS_MODULE_HASH.exec(c)
  return m ? m[1] : c
}

export function meaningfulClasses(el: Element): string[] {
  const out: string[] = []
  for (const raw of Array.from(el.classList)) {
    const c = stripClassHash(raw)
    if (isMeaningfulClass(c) && !out.includes(c)) out.push(c)
  }
  return out
}

export function getElementClasses(el: Element): string {
  return meaningfulClasses(el).join(', ')
}

// -- text utilities --------------------------------------------------------

function normText(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

function textOf(el: Element): string {
  return normText(el.textContent)
}

function head(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() : s
}

function tag(el: Element): string {
  return el.tagName.toLowerCase()
}

function isShadowRoot(node: Node | null): node is ShadowRoot {
  return !!node && node.nodeType === Node.DOCUMENT_FRAGMENT_NODE && 'host' in node
}

/** Parent element, crossing a shadow boundary to the host. Second value says whether we crossed. */
function parentAcrossShadow(el: Element): { parent: Element | null; crossed: boolean } {
  if (el.parentElement) return { parent: el.parentElement, crossed: false }
  const root = el.getRootNode()
  if (isShadowRoot(root)) return { parent: root.host, crossed: true }
  return { parent: null, crossed: false }
}

// -- paths -----------------------------------------------------------------

/** `#id` > first meaningful class > tag. */
export function nodeIdentifier(el: Element): string {
  if (el.id) return `#${el.id}`
  const [cls] = meaningfulClasses(el)
  if (cls) return `.${cls}`
  return tag(el)
}

/**
 * `parent > child` chain, innermost last. Stops at html/body or after `maxDepth`
 * nodes; a cut chain is prefixed with `… > `.
 */
export function getElementPath(el: Element, maxDepth: number = PATH_MAX_DEPTH): string {
  const parts: string[] = []
  let current: Element | null = el
  let truncated = false
  while (current) {
    const t = tag(current)
    if (t === 'html' || t === 'body') break
    if (parts.length >= maxDepth) {
      truncated = true
      break
    }
    const { parent, crossed } = parentAcrossShadow(current)
    parts.unshift((crossed ? SHADOW_PREFIX : '') + nodeIdentifier(current))
    current = parent
  }
  return (truncated ? TRUNCATED_PREFIX : '') + parts.join(' > ')
}

/** Same chain with no depth cap (forensic level). Never prefixed. */
export function getFullElementPath(el: Element): string {
  return getElementPath(el, Infinity)
}

// -- identify --------------------------------------------------------------

const SVG_GRAPHIC_TAGS = new Set(['path', 'circle', 'rect', 'line', 'g', 'polygon', 'polyline', 'ellipse'])
const CONTAINER_TAGS = new Set(['div', 'section', 'article', 'nav', 'header', 'footer', 'aside', 'main'])

export interface ElementIdentity {
  name: string
  path: string
}

function closestSvg(el: Element): Element | null {
  let p = el.parentElement
  while (p) {
    if (tag(p) === 'svg') return p
    p = p.parentElement
  }
  return null
}

function closestTag(el: Element, t: string): Element | null {
  let p = el.parentElement
  while (p) {
    if (tag(p) === t) return p
    p = p.parentElement
  }
  return null
}

export function identifyElement(el: Element): ElementIdentity {
  return { name: elementName(el), path: getElementPath(el) }
}

function elementName(el: Element): string {
  const explicit = el.getAttribute('data-element')
  if (explicit) return explicit

  const t = tag(el)
  const text = textOf(el)

  if (SVG_GRAPHIC_TAGS.has(t)) {
    const svg = closestSvg(el)
    return svg ? `graphic in ${elementName(svg)}` : 'graphic element'
  }

  if (t === 'svg') {
    const btn = closestTag(el, 'button')
    if (btn) {
      const btnText = textOf(btn)
      return btnText ? `icon in "${head(btnText, 25)}" button` : 'button icon'
    }
    return 'icon'
  }

  if (t === 'button') {
    const label = el.getAttribute('aria-label')
    if (label) return `button [${label}]`
    if (text) return `button "${head(text, 25)}"`
    return 'button'
  }

  if (t === 'a') {
    if (text) return `link "${head(text, 25)}"`
    const href = el.getAttribute('href')
    if (href) return `link to ${head(href, 30)}`
    return 'link'
  }

  if (t === 'input') {
    const placeholder = el.getAttribute('placeholder')
    if (placeholder) return `input "${placeholder}"`
    const name = el.getAttribute('name')
    if (name) return `input [${name}]`
    return `${el.getAttribute('type') || 'text'} input`
  }

  if (/^h[1-6]$/.test(t) && text) return `${t} "${head(text, 35)}"`

  if (t === 'p' && text) return `paragraph: "${head(text, 40)}${text.length > 40 ? '...' : ''}"`

  if ((t === 'span' || t === 'label') && text && text.length < 40) return `"${text}"`

  if (t === 'li' && text && text.length < 40) return `list item: "${head(text, 35)}"`

  if (t === 'blockquote') return 'blockquote'

  if (t === 'code' && text && text.length < 30) return `code: \`${text}\``

  if (t === 'pre') return 'code block'

  if (t === 'img') {
    const alt = el.getAttribute('alt')
    return alt ? `image "${head(alt, 30)}"` : 'image'
  }

  if (t === 'video') return 'video'

  if (CONTAINER_TAGS.has(t)) {
    const label = el.getAttribute('aria-label')
    if (label) return label
    const role = el.getAttribute('role')
    if (role) return role
    const words = meaningfulClasses(el).slice(0, 2)
    if (words.length) return words.join(' ')
    return t === 'div' ? 'container' : t
  }

  return t
}

// -- nearby ----------------------------------------------------------------

const NEARBY_TEXT_CAP = 40
const OWN_TEXT_CAP = 50
const NEARBY_ELEMENTS_CAP = 4

function siblingText(el: Element, dir: 'prev' | 'next'): string {
  let n: Node | null = dir === 'prev' ? el.previousSibling : el.nextSibling
  while (n) {
    const t = normText(n.textContent)
    if (t) return t
    n = dir === 'prev' ? n.previousSibling : n.nextSibling
  }
  return ''
}

/** `[before: "..."] own text [after: "..."]`, empty pieces dropped. */
export function getNearbyText(el: Element): string {
  const before = siblingText(el, 'prev')
  const after = siblingText(el, 'next')
  const own = head(textOf(el), OWN_TEXT_CAP)
  const parts: string[] = []
  if (before) parts.push(`[before: "${before.slice(-NEARBY_TEXT_CAP)}"]`)
  if (own) parts.push(own)
  if (after) parts.push(`[after: "${head(after, NEARBY_TEXT_CAP)}"]`)
  return parts.join(' ')
}

function siblingMarker(el: Element): string {
  const [cls] = meaningfulClasses(el)
  const text = textOf(el)
  const base = cls ? `${tag(el)}.${cls}` : tag(el)
  return text && text.length <= 30 ? `${base} "${text}"` : base
}

/** Up to 4 sibling markers, with `(N total in <parent>)` when more exist. */
export function getNearbyElements(el: Element): string {
  const parent = el.parentElement
  if (!parent) return ''
  const siblings = Array.from(parent.children).filter((c) => c !== el)
  if (siblings.length === 0) return ''
  const shown = siblings.slice(0, NEARBY_ELEMENTS_CAP).map(siblingMarker).join(', ')
  if (siblings.length <= NEARBY_ELEMENTS_CAP) return shown
  return `${shown} (${siblings.length} total in ${nodeIdentifier(parent)})`
}

// -- computed styles -------------------------------------------------------

const DETAILED_PROPS = [
  'display', 'position', 'width', 'height', 'margin', 'padding', 'border', 'border-radius',
  'background-color', 'color', 'font-size', 'font-weight', 'font-family', 'line-height',
  'text-align', 'opacity', 'z-index', 'overflow', 'flex-direction', 'gap', 'justify-content',
  'align-items', 'grid-template-columns', 'box-shadow', 'cursor',
] as const

const FORENSIC_PROPS = [
  'display', 'position', 'top', 'left', 'width', 'height', 'margin', 'padding', 'border',
  'border-radius', 'box-sizing', 'background-color', 'color', 'font-family', 'font-size',
  'font-weight', 'line-height', 'letter-spacing', 'text-align', 'opacity', 'z-index',
  'overflow', 'transform', 'visibility',
] as const

const GENERIC_DEFAULTS = new Set(['', 'none', 'auto', '0', '0px', 'transparent', 'normal', 'static', 'visible', 'rgba(0, 0, 0, 0)'])

const PROP_DEFAULTS: Record<string, string> = {
  opacity: '1',
  'font-weight': '400',
  'flex-direction': 'row',
  'border-radius': '0px',
  'line-height': 'normal',
  'justify-content': 'normal',
  'align-items': 'normal',
  'text-align': 'start',
  overflow: 'visible',
  cursor: 'auto',
}

const BLOCK_TAGS = new Set(['div', 'p', 'section', 'article', 'nav', 'header', 'footer', 'aside', 'main', 'ul', 'ol', 'li', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'blockquote', 'table', 'body', 'html'])
const INLINE_TAGS = new Set(['span', 'a', 'label', 'code', 'strong', 'em', 'b', 'i', 'small', 'mark'])

function tagDefault(t: string, prop: string): string | undefined {
  if (prop === 'display') {
    if (BLOCK_TAGS.has(t)) return 'block'
    if (INLINE_TAGS.has(t)) return 'inline'
    if (t === 'button' || t === 'input' || t === 'select' || t === 'img') return 'inline-block'
  }
  if (prop === 'cursor' && (t === 'button' || t === 'a')) return 'pointer'
  if (prop === 'font-weight' && (/^h[1-6]$/.test(t) || t === 'strong' || t === 'b')) return '700'
  return undefined
}

function isDefaultValue(t: string, prop: string, value: string): boolean {
  if (GENERIC_DEFAULTS.has(value)) return true
  if (/^(0px\s?)+$/.test(value)) return true
  if (prop === 'border' && /\bnone\b/.test(value)) return true
  if (PROP_DEFAULTS[prop] === value) return true
  return tagDefault(t, prop) === value
}

/** Sparse map of non-default, element-relevant computed styles. */
export function getDetailedComputedStyles(el: Element): Record<string, string> {
  const cs = getComputedStyle(el)
  const t = tag(el)
  const out: Record<string, string> = {}
  for (const prop of DETAILED_PROPS) {
    const value = cs.getPropertyValue(prop).trim()
    if (!isDefaultValue(t, prop, value)) out[prop] = value
  }
  return out
}

/** Wider 24-property set as `key: value; key: value` (forensic level). */
export function getForensicComputedStyles(el: Element): string {
  const cs = getComputedStyle(el)
  const parts: string[] = []
  for (const prop of FORENSIC_PROPS) {
    const value = cs.getPropertyValue(prop).trim()
    if (value) parts.push(`${prop}: ${value}`)
  }
  return parts.join('; ')
}

// -- accessibility ---------------------------------------------------------

const NATIVELY_FOCUSABLE = new Set(['button', 'input', 'select', 'textarea', 'summary'])

function isFocusable(el: Element): boolean {
  if (el.hasAttribute('disabled')) return false
  const tabindex = el.getAttribute('tabindex')
  if (tabindex !== null) return Number(tabindex) >= 0
  const t = tag(el)
  if (NATIVELY_FOCUSABLE.has(t)) return true
  if ((t === 'a' || t === 'area') && el.hasAttribute('href')) return true
  return (el as HTMLElement).isContentEditable === true
}

/** `role="x", aria-label="y", tabindex=0, focusable` — only present bits. */
export function getAccessibilityInfo(el: Element): string {
  const parts: string[] = []
  for (const attr of ['role', 'aria-label', 'aria-describedby', 'aria-hidden'] as const) {
    const v = el.getAttribute(attr)
    if (v) parts.push(`${attr}="${v}"`)
  }
  const tabindex = el.getAttribute('tabindex')
  if (tabindex !== null) parts.push(`tabindex=${tabindex}`)
  if (isFocusable(el)) parts.push('focusable')
  return parts.join(', ')
}

// -- geometry / hit testing ------------------------------------------------

/** `document.elementFromPoint` that descends into open shadow roots to the innermost element. */
export function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y)
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y)
    if (!inner || inner === el) break
    el = inner
  }
  return el
}

/** True when the element or any ancestor (across shadow hosts) is position: fixed | sticky. */
export function isElementFixed(el: Element): boolean {
  let current: Element | null = el
  while (current && tag(current) !== 'html') {
    const pos = getComputedStyle(current).position
    if (pos === 'fixed' || pos === 'sticky') return true
    current = parentAcrossShadow(current).parent
  }
  return false
}

// -- relocatable identity --------------------------------------------------

const SELECTOR_ATTRS = ['data-testid', 'data-test', 'data-cy', 'data-element', 'name', 'aria-label']

function finderIn(el: Element, root: Element | ShadowRoot): string {
  return finder(el, {
    root: root as Element,
    timeoutMs: 300,
    className: isMeaningfulClass,
    attr: (name) => SELECTOR_ATTRS.includes(name),
    seedMinLength: 2,
  })
}

/** Unique CSS selector (via @medv/finder); ` >>> ` across shadow hosts; null when none found. */
export function getUniqueSelector(el: Element): string | null {
  try {
    const root = el.getRootNode()
    if (isShadowRoot(root)) {
      const hostSelector = getUniqueSelector(root.host)
      if (!hostSelector) return null
      return `${hostSelector}${SHADOW_SEPARATOR}${finderIn(el, root)}`
    }
    return finderIn(el, document.body)
  } catch {
    return null
  }
}

function xpathStep(el: Element): string {
  const t = tag(el)
  const parent: Node | null = el.parentNode
  if (!parent) return `/${t}`
  const same = Array.from(parent.childNodes).filter(
    (n): n is Element => n.nodeType === Node.ELEMENT_NODE && tag(n as Element) === t
  )
  if (same.length <= 1) return `/${t}`
  return `/${t}[${same.indexOf(el) + 1}]`
}

/** Positional XPath (`/html/body/div[2]/main/button[1]`); ` >>> ` across shadow hosts. */
export function getXPath(el: Element): string {
  const steps: string[] = []
  let current: Element | null = el
  while (current) {
    steps.unshift(xpathStep(current))
    if (current.parentElement) {
      current = current.parentElement
      continue
    }
    const root = current.getRootNode()
    if (isShadowRoot(root)) return `${getXPath(root.host)}${SHADOW_SEPARATOR}${steps.join('')}`
    current = null
  }
  return steps.join('')
}

export interface RelocationHints {
  rect: { x: number; y: number; width: number; height: number; top: number; left: number; right: number; bottom: number }
  scrollX: number
  scrollY: number
  viewport: { width: number; height: number }
  dpr: number
  textHash: string
}

/** 32-bit FNV-1a as 8 hex chars. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Geometry + text hash so a relocator can score candidates when selector and XPath both miss. */
export function getRelocationHints(el: Element): RelocationHints {
  const r = el.getBoundingClientRect()
  return {
    rect: { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, left: r.left, right: r.right, bottom: r.bottom },
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    dpr: window.devicePixelRatio || 1,
    textHash: fnv1a(textOf(el).slice(0, 200)),
  }
}

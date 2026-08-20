import type { PickIntent, PickRect, WidgetPick } from '../types'
import { aggregateRect, multiPickName } from './multi-select'
import {
  getAccessibilityInfo,
  getDetailedComputedStyles,
  getElementClasses,
  getFullElementPath,
  getNearbyElements,
  getNearbyText,
  getRelocationHints,
  getUniqueSelector,
  getXPath,
  identifyElement,
  isElementFixed,
} from './element-pick'

export function newPickId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `pk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

/** Viewport rect -> document rect unless the element is fixed/sticky (then viewport coords are kept). */
export function pageRect(rect: DOMRect | PickRect, isFixed: boolean): PickRect {
  return {
    x: Math.round(rect.x + (isFixed ? 0 : window.scrollX)),
    y: Math.round(rect.y + (isFixed ? 0 : window.scrollY)),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

export interface BuildPickOptions {
  id?: string
  comment?: string
  intent?: PickIntent
  /** The page selection at click time (PULSE-353); omitted from the pick when empty. */
  selectedText?: string
}

/**
 * Captures everything the four Linear detail levels need from one element,
 * at pick time. Comment and intent are filled in by the popup afterwards.
 */
export function buildPick(el: Element, options: BuildPickOptions = {}): WidgetPick {
  const isFixed = isElementFixed(el)
  const { name, path } = identifyElement(el)
  const pick: WidgetPick = {
    id: options.id ?? newPickId(),
    elementPath: path,
    name,
    classes: getElementClasses(el),
    boundingBox: pageRect(el.getBoundingClientRect(), isFixed),
    nearbyText: getNearbyText(el),
    comment: options.comment ?? '',
    intent: options.intent ?? 'fix',
    isFixed,
    fullPath: getFullElementPath(el),
    computedStyles: getDetailedComputedStyles(el),
    accessibility: getAccessibilityInfo(el),
    nearbyElements: getNearbyElements(el),
    selector: getUniqueSelector(el),
    xpath: getXPath(el),
    relocation: getRelocationHints(el),
  }
  // Absent rather than empty: the renderer branches on presence.
  if (options.selectedText) pick.selectedText = options.selectedText
  return pick
}

/**
 * One annotation spanning several elements (PULSE-331). Metadata (path, classes,
 * computed styles, accessibility) comes from the FIRST element only — a
 * multi-pick is a selection of related elements, not an aggregation of their
 * data. Every rect is projected into the first element's coordinate frame so the
 * aggregate box stays in one coordinate space.
 */
export function buildMultiPick(elements: Element[], options: BuildPickOptions = {}): WidgetPick {
  const [first] = elements
  const base = buildPick(first, options)
  if (elements.length < 2) return base

  const boxes = elements.map((el) => pageRect(el.getBoundingClientRect(), base.isFixed))
  return {
    ...base,
    name: multiPickName(elements.map((el) => identifyElement(el).name)),
    isMultiSelect: true,
    boundingBox: aggregateRect(boxes),
    elementBoundingBoxes: boxes,
  }
}

/**
 * An empty region the user swept out (PULSE-350). No element metadata is
 * captured — there is no element — so only the geometry and the comment carry
 * meaning. `rect` is in viewport coordinates; area picks are never fixed.
 */
export function buildAreaPick(rect: PickRect, options: BuildPickOptions = {}): WidgetPick {
  const area = pageRect(rect, false)
  return {
    id: options.id ?? newPickId(),
    elementPath: `region at (${area.x}, ${area.y})`,
    name: 'Area selection',
    classes: '',
    boundingBox: area,
    nearbyText: '',
    comment: options.comment ?? '',
    intent: options.intent ?? 'fix',
    isFixed: false,
    isArea: true,
    areaRect: area,
  }
}

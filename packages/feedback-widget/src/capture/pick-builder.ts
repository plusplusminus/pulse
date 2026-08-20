import type { PickIntent, PickRect, WidgetPick } from '../types'
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
  return pick
}

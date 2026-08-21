// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  isMeaningfulClass,
  stripClassHash,
  getElementClasses,
  getElementPath,
  getFullElementPath,
  identifyElement,
  getNearbyText,
  getNearbyElements,
  getDetailedComputedStyles,
  getAccessibilityInfo,
  deepElementFromPoint,
  isElementFixed,
  getUniqueSelector,
  getXPath,
  getRelocationHints,
  fnv1a,
  TRUNCATED_PREFIX,
  SHADOW_PREFIX,
} from './element-pick'

function mount(html: string): HTMLElement {
  document.body.innerHTML = html
  return document.body
}

function q<T extends Element = HTMLElement>(sel: string): T {
  const el = document.querySelector<T>(sel)
  if (!el) throw new Error(`fixture missing ${sel}`)
  return el
}

beforeEach(() => {
  document.body.innerHTML = ''
  document.head.innerHTML = ''
})

describe('isMeaningfulClass / stripClassHash', () => {
  it('rejects short, 1-2 letter, and hash-like classes', () => {
    expect(isMeaningfulClass('ab')).toBe(false)
    expect(isMeaningfulClass('a')).toBe(false)
    expect(isMeaningfulClass('mt')).toBe(false)
    expect(isMeaningfulClass('XK9PQ2')).toBe(false)
    expect(isMeaningfulClass('css-ABCDE')).toBe(false)
  })
  it('accepts ordinary semantic classes', () => {
    expect(isMeaningfulClass('btn')).toBe(true)
    expect(isMeaningfulClass('hero-title')).toBe(true)
    expect(isMeaningfulClass('Button')).toBe(true)
  })
  it('strips CSS-module hashes and leaves others alone', () => {
    expect(stripClassHash('button_a1b2c3')).toBe('button')
    expect(stripClassHash('btn-primary')).toBe('btn-primary')
    expect(stripClassHash('card_x1')).toBe('card_x1')
  })
})

describe('getElementClasses', () => {
  it('de-hashes, de-dupes and drops meaningless classes', () => {
    mount('<div id="t" class="card card_ab12cd mt p-4 XK9PQ2 hero"></div>')
    expect(getElementClasses(q('#t'))).toBe('card, p-4, hero')
  })
  it('works on SVG elements (classList, not className string)', () => {
    mount('<svg class="icon large"><path class="stroke"/></svg>')
    expect(getElementClasses(q('svg'))).toBe('icon, large')
  })
})

describe('getElementPath', () => {
  it('prefers #id, then meaningful class, then tag', () => {
    mount('<main><section class="hero"><div id="cta"><button class="ab">Go</button></div></section></main>')
    expect(getElementPath(q('button'))).toBe('main > .hero > #cta > button')
  })
  it('falls through hashed-only classes to the tag', () => {
    mount('<div class="XK9PQ2 ab"><span class="ZZZZZ9">x</span></div>')
    expect(getElementPath(q('span'))).toBe('div > span')
  })
  it('depth 0..4 are exact, 5+ truncate with the ellipsis prefix', () => {
    mount('<div class="lv1"><div class="lv2"><div class="lv3"><div class="lv4"><div class="lv5"><i>x</i></div></div></div></div></div>')
    expect(getElementPath(q('.lv1'))).toBe('.lv1')
    expect(getElementPath(q('.lv2'))).toBe('.lv1 > .lv2')
    expect(getElementPath(q('.lv3'))).toBe('.lv1 > .lv2 > .lv3')
    expect(getElementPath(q('.lv4'))).toBe('.lv1 > .lv2 > .lv3 > .lv4')
    expect(getElementPath(q('.lv5'))).toBe(`${TRUNCATED_PREFIX}.lv2 > .lv3 > .lv4 > .lv5`)
    expect(getElementPath(q('i'))).toBe(`${TRUNCATED_PREFIX}.lv3 > .lv4 > .lv5 > i`)
    expect(getElementPath(q('i'), 2)).toBe(`${TRUNCATED_PREFIX}.lv5 > i`)
  })
  it('stops at body/html without prefix', () => {
    mount('<p>hi</p>')
    expect(getElementPath(q('p'))).toBe('p')
    expect(getElementPath(document.body)).toBe('')
  })
  it('crosses a shadow root and marks the boundary', () => {
    mount('<div class="app"><x-host></x-host></div>')
    const host = q('x-host')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<div class="inner"><button>In</button></div>'
    const btn = root.querySelector('button')!
    expect(getElementPath(btn)).toBe(`.app > x-host > ${SHADOW_PREFIX}.inner > button`)
  })
  it('getFullElementPath has no cap and no prefix', () => {
    mount('<div class="lv1"><div class="lv2"><div class="lv3"><div class="lv4"><div class="lv5"><i>x</i></div></div></div></div></div>')
    expect(getFullElementPath(q('i'))).toBe('.lv1 > .lv2 > .lv3 > .lv4 > .lv5 > i')
  })
})

describe('identifyElement', () => {
  const cases: Array<[string, string, string]> = [
    ['data-element', '<div data-element="Pricing card"></div>', 'Pricing card'],
    ['svg graphic in button icon', '<button>Save<svg><path id="t"/></svg></button>', 'graphic in icon in "Save" button'],
    ['svg graphic in bare icon', '<svg><circle id="t"/></svg>', 'graphic in icon'],
    ['orphan graphic', '<g id="t"></g>', 'graphic element'],
    ['svg in button with text', '<button>Delete <svg id="t"></svg></button>', 'icon in "Delete" button'],
    ['svg in empty button', '<button><svg id="t"></svg></button>', 'button icon'],
    ['svg plain', '<svg id="t"></svg>', 'icon'],
    ['button aria-label', '<button id="t" aria-label="Close dialog">x</button>', 'button [Close dialog]'],
    ['button text (25 cap)', '<button id="t">Sign up for the newsletter today</button>', 'button "Sign up for the newslette"'],
    ['button empty', '<button id="t"></button>', 'button'],
    ['link text', '<a id="t" href="/x">Docs</a>', 'link "Docs"'],
    ['link href only', '<a id="t" href="https://example.com/very/long/path/here"></a>', 'link to https://example.com/very/long/'],
    ['link empty', '<a id="t"></a>', 'link'],
    ['input placeholder', '<input id="t" placeholder="Email address" name="email">', 'input "Email address"'],
    ['input name', '<input id="t" name="email">', 'input [email]'],
    ['input type', '<input id="t" type="checkbox">', 'checkbox input'],
    ['input default type', '<input id="t">', 'text input'],
    ['heading', '<h2 id="t">Pricing that scales with your team and more</h2>', 'h2 "Pricing that scales with your team"'],
    ['paragraph short', '<p id="t">Short para.</p>', 'paragraph: "Short para."'],
    ['paragraph long', '<p id="t">This paragraph is definitely longer than forty characters.</p>', 'paragraph: "This paragraph is definitely longer than..."'],
    ['span short', '<span id="t">Label text</span>', '"Label text"'],
    ['label short', '<label id="t">Email</label>', '"Email"'],
    ['span long falls to tag', `<span id="t">${'x'.repeat(45)}</span>`, 'span'],
    ['li short', '<li id="t">First item</li>', 'list item: "First item"'],
    ['blockquote', '<blockquote id="t">q</blockquote>', 'blockquote'],
    ['code short', '<code id="t">npm i</code>', 'code: `npm i`'],
    ['pre', '<pre id="t">x</pre>', 'code block'],
    ['img alt', '<img id="t" alt="Team photo at the offsite retreat">', 'image "Team photo at the offsite retr"'],
    ['img no alt', '<img id="t">', 'image'],
    ['video', '<video id="t"></video>', 'video'],
    ['container aria-label', '<section id="t" aria-label="Pricing" class="hero">x</section>', 'Pricing'],
    ['container role', '<div id="t" role="dialog" class="modal">x</div>', 'dialog'],
    ['container classes', '<div id="t" class="hero cta extra">x</div>', 'hero cta'],
    ['div fallback', '<div id="t">x</div>', 'container'],
    ['nav fallback', '<nav id="t"></nav>', 'nav'],
    ['anything else', '<figure id="t">x</figure>', 'figure'],
  ]
  it.each(cases)('%s', (_label, html, expected) => {
    mount(html.includes('id="t"') ? html : html.replace(/^<(\w[\w-]*)/, '<$1 id="t"'))
    const el = q('#t')
    const { name, path } = identifyElement(el)
    expect(name).toBe(expected)
    expect(path).toBe(getElementPath(el))
  })
})

describe('getNearbyText', () => {
  it('includes before/own/after and drops empty pieces', () => {
    mount('<div>Get started <button>Sign up</button> today</div>')
    expect(getNearbyText(q('button'))).toBe('[before: "Get started"] Sign up [after: "today"]')
  })
  it('truncates before (tail 40) / own (50) / after (head 40)', () => {
    const long = 'abcdefghij'.repeat(6) // 60
    mount(`<div><span>${long}</span><button>${long}</button><span>${long}</span></div>`)
    const out = getNearbyText(q('button'))
    expect(out).toBe(`[before: "${long.slice(-40)}"] ${long.slice(0, 50)} [after: "${long.slice(0, 40)}"]`)
  })
  it('returns empty for an empty element with no siblings', () => {
    mount('<div><button></button></div>')
    expect(getNearbyText(q('button'))).toBe('')
  })
})

describe('getNearbyElements', () => {
  it('lists siblings with tag.firstClass and short text', () => {
    mount('<div class="cta"><button class="primary">Sign up</button><a class="link" href="#">Docs</a><div class="spacer"></div><i id="t"></i></div>')
    expect(getNearbyElements(q('#t'))).toBe('button.primary "Sign up", a.link "Docs", div.spacer')
  })
  it('caps at 4 and reports the total in the parent identifier', () => {
    mount(`<ul class="grid">${'<li class="cell"></li>'.repeat(11)}<li id="t"></li></ul>`)
    expect(getNearbyElements(q('#t'))).toBe('li.cell, li.cell, li.cell, li.cell (11 total in .grid)')
  })
  it('returns empty without siblings', () => {
    mount('<div><i id="t"></i></div>')
    expect(getNearbyElements(q('#t'))).toBe('')
  })
})

describe('computed styles', () => {
  it('skips generic and tag defaults, keeps set values', () => {
    mount('<style>#t{color:red;font-size:18px;display:block;position:static;opacity:1;margin:0px}</style><button id="t">x</button>')
    const styles = getDetailedComputedStyles(q('#t'))
    expect(styles.color).toBe('rgb(255, 0, 0)')
    expect(styles['font-size']).toBe('18px')
    expect(styles.display).toBe('block') // non-default for a button
    expect(styles).not.toHaveProperty('position')
    expect(styles).not.toHaveProperty('opacity')
    expect(styles).not.toHaveProperty('margin')
    expect(styles).not.toHaveProperty('cursor')
  })
  it('drops the tag default display for a div', () => {
    mount('<style>#t{display:block}</style><div id="t"></div>')
    expect(getDetailedComputedStyles(q('#t'))).not.toHaveProperty('display')
  })
})

describe('getAccessibilityInfo', () => {
  it('renders present ARIA bits + focusability', () => {
    mount('<button id="t" role="button" aria-label="Sign up">x</button>')
    expect(getAccessibilityInfo(q('#t'))).toBe('role="button", aria-label="Sign up", focusable')
  })
  it('handles missing ARIA cleanly', () => {
    mount('<div id="t">x</div>')
    expect(getAccessibilityInfo(q('#t'))).toBe('')
    mount('<div id="t" tabindex="-1" aria-hidden="true">x</div>')
    expect(getAccessibilityInfo(q('#t'))).toBe('aria-hidden="true", tabindex=-1')
    mount('<div id="t" tabindex="0">x</div>')
    expect(getAccessibilityInfo(q('#t'))).toBe('tabindex=0, focusable')
    mount('<button id="t" disabled>x</button>')
    expect(getAccessibilityInfo(q('#t'))).toBe('')
  })
})

describe('deepElementFromPoint', () => {
  afterEach(() => vi.restoreAllMocks())
  it('descends multiple shadow levels', () => {
    mount('<x-outer></x-outer>')
    const outer = q('x-outer')
    const outerRoot = outer.attachShadow({ mode: 'open' })
    outerRoot.innerHTML = '<x-inner></x-inner>'
    const inner = outerRoot.querySelector('x-inner')!
    const innerRoot = inner.attachShadow({ mode: 'open' })
    innerRoot.innerHTML = '<button>deep</button>'
    const deep = innerRoot.querySelector('button')!

    document.elementFromPoint = vi.fn(() => outer)
    ;(outerRoot as ShadowRoot).elementFromPoint = vi.fn(() => inner)
    ;(innerRoot as ShadowRoot).elementFromPoint = vi.fn(() => deep)

    expect(deepElementFromPoint(10, 10)).toBe(deep)
  })
  it('returns the light-DOM element when there is no shadow root', () => {
    mount('<p>x</p>')
    const p = q('p')
    document.elementFromPoint = vi.fn(() => p)
    expect(deepElementFromPoint(1, 1)).toBe(p)
  })
  it('stops when the shadow root returns the host itself', () => {
    mount('<x-host></x-host>')
    const host = q('x-host')
    const root = host.attachShadow({ mode: 'open' })
    document.elementFromPoint = vi.fn(() => host)
    ;(root as ShadowRoot).elementFromPoint = vi.fn(() => host)
    expect(deepElementFromPoint(1, 1)).toBe(host)
  })
})

describe('isElementFixed', () => {
  it('true for sticky/fixed ancestors, false in normal flow', () => {
    mount('<style>.nav{position:sticky}.fx{position:fixed}</style><nav class="nav"><a id="s">x</a></nav><div class="fx"><i id="f"></i></div><p id="n">x</p>')
    expect(isElementFixed(q('#s'))).toBe(true)
    expect(isElementFixed(q('#f'))).toBe(true)
    expect(isElementFixed(q('#n'))).toBe(false)
  })
})

describe('getUniqueSelector / getXPath', () => {
  const fixture = `
    <main id="app">
      <header class="top"><nav><a href="/a">A</a><a href="/b">B</a></nav></header>
      <section class="hero">
        <div class="cta"><button class="btn primary">Sign up</button><button class="btn">Log in</button></div>
        <div class="cta"><button class="btn">Other</button></div>
        <input name="email"><input name="email2" data-testid="second">
        <ul><li>1</li><li>2</li><li>3</li></ul>
        <div><div><div><span>deep</span></div></div></div>
      </section>
      <footer><p>f</p></footer>
    </main>`

  it('unique selector round-trips for every element in the fixture', () => {
    mount(fixture)
    const all = Array.from(document.body.querySelectorAll('*'))
    expect(all.length).toBeGreaterThan(15)
    for (const el of all) {
      const sel = getUniqueSelector(el)
      expect(sel, `selector for <${el.tagName.toLowerCase()}>`).not.toBeNull()
      expect(document.querySelector(sel!)).toBe(el)
    }
  })
  it('xpath round-trips via document.evaluate for every element', () => {
    mount(fixture)
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const xp = getXPath(el)
      const found = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue
      expect(found, xp).toBe(el)
    }
    expect(getXPath(q('.cta .primary'))).toBe('/html/body/main/section/div[1]/button[1]')
  })
  it('crosses shadow roots with >>>', () => {
    mount('<div id="wrap"><x-host></x-host></div>')
    const host = q('x-host')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<div class="inner"><button>a</button><button>b</button></div>'
    const b = root.querySelectorAll('button')[1]
    const sel = getUniqueSelector(b)
    expect(sel).not.toBeNull()
    const [hostSel, innerSel] = sel!.split(' >>> ')
    expect(document.querySelector(hostSel)).toBe(host)
    expect(root.querySelector(innerSel)).toBe(b)
    expect(getXPath(b)).toBe('/html/body/div/x-host >>> /div/button[2]')
  })
  it('returns null instead of throwing when finder fails', () => {
    const detached = document.createElement('div')
    expect(getUniqueSelector(detached)).toBeNull()
  })
})

describe('getRelocationHints / fnv1a', () => {
  it('fnv1a is stable and 8 hex chars', () => {
    expect(fnv1a('')).toBe('811c9dc5')
    expect(fnv1a('hello')).toBe('4f9f2cab')
    expect(fnv1a('hello')).toBe(fnv1a('hello'))
  })
  it('captures geometry, scroll, viewport, dpr and a text hash', () => {
    mount('<button id="t">  Sign   up </button>')
    const h = getRelocationHints(q('#t'))
    expect(Object.keys(h.rect).sort()).toEqual(['bottom', 'height', 'left', 'right', 'top', 'width', 'x', 'y'])
    expect(h.viewport.width).toBe(window.innerWidth)
    expect(h.dpr).toBeGreaterThan(0)
    expect(h.textHash).toBe(fnv1a('Sign up'))
  })
})

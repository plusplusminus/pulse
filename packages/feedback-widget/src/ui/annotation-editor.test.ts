// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AnnotationEditor, createAnnotationEditor, normaliseRect } from './annotation-editor'
import type { AnnotationEditorState, ScreenshotAnnotation } from '../types'

/**
 * jsdom has no 2D context and cannot decode an image, so both are stubbed. The
 * editor's geometry is what is under test; the pixels are covered by
 * annotation-paint.test.ts.
 */
const CAPTURE = { width: 1200, height: 800 }

const exported: Array<{ width: number; height: number }> = []

function recordingContext(): CanvasRenderingContext2D {
  const noop = () => {}
  return {
    save: noop,
    restore: noop,
    beginPath: noop,
    closePath: noop,
    rect: noop,
    fill: noop,
    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    drawImage: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    stroke: noop,
    arc: noop,
    ellipse: noop,
    fillText: noop,
    strokeText: noop,
    translate: noop,
    setLineDash: noop,
    measureText: (t: string) => ({ width: t.length * 8 }),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    font: '',
    textBaseline: '',
  } as unknown as CanvasRenderingContext2D
}

let restoreCreateElement: (() => void) | null = null

function installHarness(): void {
  exported.length = 0

  const realCreate = document.createElement.bind(document)
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreate(tag)
    if (tag === 'canvas') {
      const canvas = el as HTMLCanvasElement
      canvas.getContext = (() => recordingContext()) as unknown as HTMLCanvasElement['getContext']
      canvas.toBlob = ((cb: BlobCallback) => {
        exported.push({ width: canvas.width, height: canvas.height })
        cb(new Blob(['png'], { type: 'image/png' }))
      }) as HTMLCanvasElement['toBlob']
      canvas.setPointerCapture = noopFn as HTMLCanvasElement['setPointerCapture']
      canvas.releasePointerCapture = noopFn as HTMLCanvasElement['releasePointerCapture']
    }
    return el
  })
  restoreCreateElement = () => spy.mockRestore()

  // A loaded bitmap, without asking jsdom to decode anything.
  class StubImage {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    naturalWidth = CAPTURE.width
    naturalHeight = CAPTURE.height
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  }
  vi.stubGlobal('Image', StubImage)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(noopFn)
}

const noopFn = () => {}

/**
 * jsdom leaves getBoundingClientRect at all-zero, which makes the editor's
 * client-to-image transform the identity — so test coordinates ARE image pixels.
 */
function pointer(canvas: HTMLElement, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  canvas.dispatchEvent(e)
}

function drag(canvas: HTMLElement, from: [number, number], to: [number, number]): void {
  pointer(canvas, 'pointerdown', from[0], from[1])
  pointer(canvas, 'pointermove', to[0], to[1])
  pointer(canvas, 'pointerup', to[0], to[1])
}

interface Harness {
  editor: AnnotationEditor
  shadow: ShadowRoot
  layer: HTMLElement
  saved: {
    blob: Blob | null
    annotations: ScreenshotAnnotation[]
    state: AnnotationEditorState | null
  }
  cancelled: () => number
}

async function mountEditor(state?: AnnotationEditorState): Promise<Harness> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const saved: Harness['saved'] = { blob: null, annotations: [], state: null }
  let cancels = 0

  const editor = createAnnotationEditor(
    shadow,
    {
      onSave: (blob, annotations, s) => {
        saved.blob = blob
        saved.annotations = annotations
        saved.state = s
      },
      onCancel: () => {
        cancels++
      },
    },
    'light'
  ) as AnnotationEditor

  await editor.show(new Blob(['png'], { type: 'image/png' }), state)
  const layer = shadow.querySelector<HTMLElement>('.pulse-annotation__layer')
  if (!layer) throw new Error('editor did not mount its canvas layer')

  return { editor, shadow, layer, saved, cancelled: () => cancels }
}

function tool(shadow: ShadowRoot, id: string): HTMLButtonElement {
  const btn = shadow.querySelector<HTMLButtonElement>(`[data-tool="${id}"]`)
  if (!btn) throw new Error(`no tool button for ${id}`)
  return btn
}

function action(shadow: ShadowRoot, id: string): HTMLButtonElement {
  const btn = shadow.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)
  if (!btn) throw new Error(`no action button for ${id}`)
  return btn
}

function marks(editor: AnnotationEditor): ScreenshotAnnotation[] {
  return editor.getAnnotations()
}

beforeEach(() => {
  installHarness()
})

afterEach(() => {
  restoreCreateElement?.()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('normaliseRect', () => {
  it('normalises drag direction and rounds to whole image pixels', () => {
    expect(normaliseRect({ x: 30.4, y: 40.6 }, { x: 10.2, y: 20.1 })).toEqual({
      x: 10,
      y: 20,
      w: 20,
      h: 21,
    })
  })
})

describe('editor shell', () => {
  it('injects its own stylesheet and removes it again on close', async () => {
    const { editor, shadow } = await mountEditor()
    expect(shadow.querySelector('style')).not.toBeNull()
    editor.hide()
    expect(shadow.querySelector('style')).toBeNull()
    expect(shadow.querySelector('.pulse-annotation')).toBeNull()
  })

  it('owns its font stack rather than inheriting the host page', async () => {
    const { shadow } = await mountEditor()
    const css = shadow.querySelector('style')?.textContent ?? ''
    expect(css).toContain('.pulse-annotation {')
    expect(css).toMatch(/font-family:\s*-apple-system/)
  })

  it('starts on highlight, so the default drag behaves as it always has', async () => {
    const { editor, layer } = await mountEditor()
    drag(layer, [100, 100], [200, 180])
    expect(marks(editor)).toEqual([{ kind: 'highlight', x: 100, y: 100, w: 100, h: 80 }])
  })

  it('switches tools from the toolbar and marks the active one', async () => {
    const { editor, shadow, layer } = await mountEditor()
    tool(shadow, 'hide').click()
    expect(tool(shadow, 'hide').getAttribute('aria-pressed')).toBe('true')
    expect(tool(shadow, 'highlight').getAttribute('aria-pressed')).toBe('false')
    drag(layer, [10, 10], [60, 50])
    expect(marks(editor)[0].kind).toBe('hide')
  })

  it('discards a stray click that never became a rect', async () => {
    const { editor, layer } = await mountEditor()
    drag(layer, [100, 100], [101, 101])
    expect(marks(editor)).toEqual([])
  })

  it('reopens with the marks it was handed', async () => {
    const existing: ScreenshotAnnotation[] = [{ kind: 'hide', x: 1, y: 2, w: 3, h: 4 }]
    const { editor } = await mountEditor({ annotations: existing, crop: null })
    expect(marks(editor)).toEqual(existing)
  })

  it('copies incoming marks rather than aliasing the array it was handed', async () => {
    const existing: ScreenshotAnnotation[] = [{ kind: 'hide', x: 1, y: 2, w: 3, h: 4 }]
    const { editor, layer } = await mountEditor({ annotations: existing, crop: null })
    drag(layer, [10, 10], [90, 90])
    expect(existing).toHaveLength(1)
    expect(marks(editor)).toHaveLength(2)
  })
})

describe('undo and redo', () => {
  it('undoes and redoes by button', async () => {
    const { editor, shadow, layer } = await mountEditor()
    drag(layer, [0, 0], [50, 50])
    drag(layer, [60, 60], [120, 120])
    expect(marks(editor)).toHaveLength(2)

    action(shadow, 'undo').click()
    expect(marks(editor)).toHaveLength(1)
    action(shadow, 'undo').click()
    expect(marks(editor)).toHaveLength(0)

    action(shadow, 'redo').click()
    expect(marks(editor)).toHaveLength(1)
    action(shadow, 'redo').click()
    expect(marks(editor)).toHaveLength(2)
  })

  it('undoes and redoes by keyboard, with shift for redo', async () => {
    const { editor, layer } = await mountEditor()
    drag(layer, [0, 0], [50, 50])

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    expect(marks(editor)).toHaveLength(0)

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true })
    )
    expect(marks(editor)).toHaveLength(1)
  })

  it('accepts ctrl+y as redo for Windows habits', async () => {
    const { editor, layer } = await mountEditor()
    drag(layer, [0, 0], [50, 50])
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    expect(marks(editor)).toHaveLength(0)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }))
    expect(marks(editor)).toHaveLength(1)
  })

  it('drops the redo branch once a new mark is made', async () => {
    const { editor, shadow, layer } = await mountEditor()
    drag(layer, [0, 0], [50, 50])
    action(shadow, 'undo').click()
    drag(layer, [60, 60], [120, 120])
    expect(action(shadow, 'redo').disabled).toBe(true)
    expect(marks(editor)).toHaveLength(1)
  })

  it('disables both buttons when there is nothing to undo or redo', async () => {
    const { shadow } = await mountEditor()
    expect(action(shadow, 'undo').disabled).toBe(true)
    expect(action(shadow, 'redo').disabled).toBe(true)
  })

  it('bounds the stack so a long session cannot grow without limit', async () => {
    const { editor, shadow, layer } = await mountEditor()
    for (let i = 0; i < 80; i++) drag(layer, [i, i], [i + 40, i + 40])
    expect(marks(editor)).toHaveLength(80)

    for (let i = 0; i < 80; i++) action(shadow, 'undo').click()
    // 60 steps of history are kept; the oldest marks can no longer be undone.
    expect(marks(editor)).toHaveLength(20)
  })

  it('starts empty for a new editor, so history never leaks across captures', async () => {
    const first = await mountEditor()
    drag(first.layer, [0, 0], [50, 50])
    first.editor.hide()

    const second = await mountEditor()
    expect(action(second.shadow, 'undo').disabled).toBe(true)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    expect(marks(second.editor)).toHaveLength(0)
  })

  it('stops listening for keys once closed', async () => {
    const { editor, layer } = await mountEditor()
    drag(layer, [0, 0], [50, 50])
    const before = marks(editor).length
    editor.hide()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }))
    expect(before).toBe(1)
  })
})

describe('selection', () => {
  it('selects the mark under the pointer and moves it by drag', async () => {
    const { editor, shadow, layer } = await mountEditor()
    drag(layer, [100, 100], [200, 200])
    tool(shadow, 'select').click()
    drag(layer, [150, 150], [170, 190])

    expect(marks(editor)).toEqual([{ kind: 'highlight', x: 120, y: 140, w: 100, h: 100 }])
  })

  it('deletes the selected mark by button and by key', async () => {
    const { editor, shadow, layer } = await mountEditor()
    drag(layer, [100, 100], [200, 200])
    drag(layer, [300, 300], [400, 400])

    tool(shadow, 'select').click()
    pointer(layer, 'pointerdown', 150, 150)
    pointer(layer, 'pointerup', 150, 150)
    action(shadow, 'delete').click()
    expect(marks(editor)).toHaveLength(1)

    pointer(layer, 'pointerdown', 350, 350)
    pointer(layer, 'pointerup', 350, 350)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }))
    expect(marks(editor)).toHaveLength(0)
  })

  it('keeps delete disabled until something is selected', async () => {
    const { shadow, layer } = await mountEditor()
    drag(layer, [100, 100], [200, 200])
    expect(action(shadow, 'delete').disabled).toBe(true)
    tool(shadow, 'select').click()
    pointer(layer, 'pointerdown', 150, 150)
    pointer(layer, 'pointerup', 150, 150)
    expect(action(shadow, 'delete').disabled).toBe(false)
  })

  it('deselects on a click that hits nothing', async () => {
    const { shadow, layer } = await mountEditor()
    drag(layer, [100, 100], [200, 200])
    tool(shadow, 'select').click()
    pointer(layer, 'pointerdown', 150, 150)
    pointer(layer, 'pointerup', 150, 150)
    pointer(layer, 'pointerdown', 900, 700)
    pointer(layer, 'pointerup', 900, 700)
    expect(action(shadow, 'delete').disabled).toBe(true)
  })

  it('undoes a move back to where it started', async () => {
    const { editor, shadow, layer } = await mountEditor()
    drag(layer, [100, 100], [200, 200])
    tool(shadow, 'select').click()
    drag(layer, [150, 150], [250, 250])
    expect(marks(editor)[0]).toMatchObject({ x: 200, y: 200 })
    action(shadow, 'undo').click()
    expect(marks(editor)[0]).toMatchObject({ x: 100, y: 100 })
  })

  it('clears everything at once and can be undone', async () => {
    const { editor, shadow, layer } = await mountEditor()
    drag(layer, [0, 0], [50, 50])
    drag(layer, [60, 60], [120, 120])
    action(shadow, 'clear').click()
    expect(marks(editor)).toHaveLength(0)
    action(shadow, 'undo').click()
    expect(marks(editor)).toHaveLength(2)
  })
})

describe('export', () => {
  it('exports at the captured bitmap size, not a clamped preview width', async () => {
    const { shadow, saved } = await mountEditor()
    const save = Array.from(
      shadow.querySelectorAll<HTMLButtonElement>('.pulse-annotation__action-btn')
    ).find((b) => b.textContent === 'Save')
    save?.click()
    await vi.waitFor(() => expect(saved.blob).not.toBeNull())
    expect(exported[exported.length - 1]).toEqual(CAPTURE)
  })

  it('has no MAX_CANVAS_WIDTH clamp to reintroduce', async () => {
    const src = await import('./annotation-editor')
    expect(Object.keys(src)).not.toContain('MAX_CANVAS_WIDTH')
  })

  it('hands back both the exported marks and the round-trip state', async () => {
    const { shadow, layer, saved } = await mountEditor()
    drag(layer, [100, 100], [200, 200])
    const save = Array.from(
      shadow.querySelectorAll<HTMLButtonElement>('.pulse-annotation__action-btn')
    ).find((b) => b.textContent === 'Save')
    save?.click()
    await vi.waitFor(() => expect(saved.blob).not.toBeNull())

    expect(saved.annotations).toEqual([{ kind: 'highlight', x: 100, y: 100, w: 100, h: 100 }])
    expect(saved.state).toEqual({
      annotations: [{ kind: 'highlight', x: 100, y: 100, w: 100, h: 100 }],
      crop: null,
    })
  })

  it('cancels without exporting', async () => {
    const { shadow, cancelled } = await mountEditor()
    const cancel = Array.from(
      shadow.querySelectorAll<HTMLButtonElement>('.pulse-annotation__action-btn')
    ).find((b) => b.textContent === 'Cancel')
    cancel?.click()
    expect(cancelled()).toBe(1)
    expect(shadow.querySelector('.pulse-annotation')).toBeNull()
  })

  it('closes on Escape when nothing is selected', async () => {
    const { cancelled } = await mountEditor()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(cancelled()).toBe(1)
  })
})

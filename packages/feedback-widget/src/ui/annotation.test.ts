// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  ANNOTATION_EDITOR_PATH,
  EDITOR_LOAD_ERROR,
  annotationEditorUrl,
  loadAnnotationEditor,
  setAnnotationEditorModule,
  type AnnotationEditorModule,
} from './annotation'

const SELECTOR = 'script[data-pulse-annotation-editor]'

function injectedScripts(): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll<HTMLScriptElement>(SELECTOR))
}

/** jsdom never fetches the src, so the load/error outcome is dispatched by hand. */
function settle(outcome: 'load' | 'error', mod?: AnnotationEditorModule): void {
  const scripts = injectedScripts()
  const script = scripts[scripts.length - 1]
  if (!script) throw new Error('no annotation-editor script was injected')
  if (mod) window.__PulseAnnotationEditor = mod
  script.dispatchEvent(new Event(outcome))
}

function stubModule(): AnnotationEditorModule {
  return { createAnnotationEditor: vi.fn() } as unknown as AnnotationEditorModule
}

beforeEach(() => {
  setAnnotationEditorModule(null)
  delete window.__PulseAnnotationEditor
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

afterEach(() => {
  setAnnotationEditorModule(null)
  delete window.__PulseAnnotationEditor
})

describe('annotationEditorUrl', () => {
  it('sits next to pulse.js on the Pulse origin', () => {
    expect(annotationEditorUrl('https://pulse.example.com')).toBe(
      `https://pulse.example.com${ANNOTATION_EDITOR_PATH}`
    )
  })
})

describe('loadAnnotationEditor', () => {
  it('injects the script once and resolves with the registered module', async () => {
    const pending = loadAnnotationEditor('https://pulse.example.com')
    expect(injectedScripts()).toHaveLength(1)
    const mod = stubModule()
    settle('load', mod)
    await expect(pending).resolves.toBe(mod)
  })

  it('requests it with anonymous CORS so a failure gives real error details', async () => {
    const pending = loadAnnotationEditor()
    expect(injectedScripts()[0].crossOrigin).toBe('anonymous')
    settle('load', stubModule())
    await pending
  })

  it('shares one load across concurrent callers', async () => {
    const a = loadAnnotationEditor()
    const b = loadAnnotationEditor()
    expect(injectedScripts()).toHaveLength(1)
    const mod = stubModule()
    settle('load', mod)
    expect(await a).toBe(mod)
    expect(await b).toBe(mod)
  })

  it('never re-fetches once loaded', async () => {
    const first = loadAnnotationEditor()
    settle('load', stubModule())
    await first
    await loadAnnotationEditor()
    expect(injectedScripts()).toHaveLength(1)
  })

  it('rejects with an instruction the panel can show, and removes the dead script', async () => {
    const pending = loadAnnotationEditor()
    settle('error')
    await expect(pending).rejects.toThrow(EDITOR_LOAD_ERROR)
    expect(injectedScripts()).toHaveLength(0)
  })

  it('rejects when the script loads but registers nothing usable', async () => {
    const pending = loadAnnotationEditor()
    window.__PulseAnnotationEditor = {} as AnnotationEditorModule
    injectedScripts()[0].dispatchEvent(new Event('load'))
    await expect(pending).rejects.toThrow(EDITOR_LOAD_ERROR)
  })

  it('retries after a failure rather than caching it forever', async () => {
    const failed = loadAnnotationEditor()
    settle('error')
    await expect(failed).rejects.toThrow()

    const retry = loadAnnotationEditor()
    expect(injectedScripts()).toHaveLength(1)
    const mod = stubModule()
    settle('load', mod)
    await expect(retry).resolves.toBe(mod)
  })

  it('adopts an editor a second Pulse instance already registered', async () => {
    const mod = stubModule()
    window.__PulseAnnotationEditor = mod
    await expect(loadAnnotationEditor()).resolves.toBe(mod)
    expect(injectedScripts()).toHaveLength(0)
  })

  it('never touches the network when the SDK has bundled the editor', async () => {
    const mod = stubModule()
    setAnnotationEditorModule(mod)
    await expect(loadAnnotationEditor()).resolves.toBe(mod)
    expect(injectedScripts()).toHaveLength(0)
  })
})

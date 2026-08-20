import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Guards the PULSE-397 split at the source level, where a regression is cheap
 * to catch. The embed is an `iife` bundle and iife cannot code-split: ANY
 * import of the engine — static, dynamic, or type-only-that-isn't — puts
 * snapdom's ~45 KB gz straight back into embed.global.js. A dist-level check
 * would need a build first; this one runs in the normal test pass.
 */

const SRC = resolve(__dirname, '..')

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, resolve(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Every module reachable from `entry`, plus every bare package specifier seen. */
function walk(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)

    const source = readFileSync(file, 'utf8')
    // Covers `from '...'`, bare `import '...'` and dynamic `import('...')`.
    const specs = [
      ...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
      ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ...source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ].map((m) => m[1])

    for (const spec of specs) {
      const resolved = resolveImport(file, spec)
      if (resolved) queue.push(resolved)
      else if (!spec.startsWith('.')) packages.add(spec)
    }
  }

  return { files, packages }
}

const ENGINE = resolve(SRC, 'capture/engine.ts')
const WEBM_DURATION_ENTRY = resolve(SRC, 'entries/webm-duration.ts')

describe('embed entry', () => {
  const graph = walk(resolve(SRC, 'entries/embed.ts'))

  it('never reaches @zumer/snapdom', () => {
    expect([...graph.packages]).not.toContain('@zumer/snapdom')
  })

  it('never reaches capture/engine.ts — iife would inline it, not chunk it', () => {
    expect([...graph.files]).not.toContain(ENGINE)
  })

  it('still reaches the screenshot loader, so capture is not simply gone', () => {
    expect([...graph.files]).toContain(resolve(SRC, 'screenshot.ts'))
  })

  it('never reaches fix-webm-duration — ~4 KB gz, only needed once a recording ends', () => {
    expect([...graph.packages]).not.toContain('fix-webm-duration')
    expect([...graph.files]).not.toContain(WEBM_DURATION_ENTRY)
  })
})

describe('sdk entry', () => {
  const graph = walk(resolve(SRC, 'entries/sdk.ts'))

  it('keeps snapdom as a package import for the consumer bundler to resolve', () => {
    expect([...graph.packages]).toContain('@zumer/snapdom')
  })

  it('bundles the engine directly rather than fetching it from the Pulse origin', () => {
    expect([...graph.files]).toContain(ENGINE)
  })
})

describe('capture-engine entry', () => {
  const graph = walk(resolve(SRC, 'entries/capture-engine.ts'))

  it('carries snapdom — it is the whole point of the artefact', () => {
    expect([...graph.packages]).toContain('@zumer/snapdom')
  })

  it('does not also drag in the duration fixer; they load independently', () => {
    expect([...graph.packages]).not.toContain('fix-webm-duration')
  })
})

describe('webm-duration entry', () => {
  const graph = walk(WEBM_DURATION_ENTRY)

  it('carries fix-webm-duration — it is the whole point of the artefact', () => {
    expect([...graph.packages]).toContain('fix-webm-duration')
  })

  it('carries nothing else: no snapdom, no widget UI', () => {
    expect([...graph.packages]).not.toContain('@zumer/snapdom')
    expect([...graph.files]).toEqual([WEBM_DURATION_ENTRY])
  })
})

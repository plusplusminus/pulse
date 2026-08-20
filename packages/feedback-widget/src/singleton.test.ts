import { describe, it, expect, vi } from 'vitest'
import { claimInstance, getActiveInstance, releaseInstance, type InstanceRegistry } from './singleton'
import type { PulseInstance } from './index'

function fakeInstance(): PulseInstance {
  return { open() {}, close() {}, destroy() {}, identify() {}, setCustom() {}, ready: Promise.resolve() }
}

describe('double-init guard', () => {
  it('creates once and returns the same instance on a second init with a warning', () => {
    const registry: InstanceRegistry = {}
    const warn = vi.fn()
    const create = vi.fn(fakeInstance)

    const first = claimInstance(create, registry, warn)
    const second = claimInstance(create, registry, warn)

    expect(second).toBe(first)
    expect(create).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/already initialised/)
    expect(getActiveInstance(registry)).toBe(first)
  })

  it('allows a fresh init after the active instance is released', () => {
    const registry: InstanceRegistry = {}
    const first = claimInstance(fakeInstance, registry, () => {})
    releaseInstance(first, registry)
    expect(getActiveInstance(registry)).toBeUndefined()
    const second = claimInstance(fakeInstance, registry, () => {})
    expect(second).not.toBe(first)
  })

  it('does not release a different instance', () => {
    const registry: InstanceRegistry = {}
    const first = claimInstance(fakeInstance, registry, () => {})
    releaseInstance(fakeInstance(), registry)
    expect(getActiveInstance(registry)).toBe(first)
  })
})

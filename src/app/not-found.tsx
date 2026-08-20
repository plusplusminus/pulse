'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

const glitches = [
  "This page pulled a Houdini.",
  "Looks like this page went off-grid.",
  "Even our best engineers can't find this one.",
  "This page is on permanent vacation.",
  "Page not found. Motivation also missing.",
  "You've reached the edge of the known internet.",
  "This page exists in a parallel universe. Not this one.",
  "Plot twist: the page was inside you all along. Just kidding, it's gone.",
  "We looked everywhere. Under the couch cushions, too.",
  "This page left no forwarding address.",
  "Gone. Reduced to atoms.",
  "The page you're looking for is in another castle.",
  "Have you tried turning it off and on again?",
  "This page was last seen running into the woods.",
  "Error: page.exe has stopped working.",
  "This page took an arrow to the knee.",
  "Congratulations, you've found nothing.",
  "The void stares back.",
  "Schrödinger's page: it both exists and doesn't. But mostly doesn't.",
  "This page was deprecated before it was cool.",
  "Task failed successfully.",
  "If you stare long enough, a page might appear. (It won't.)",
  "We blame the intern.",
  "This page is still in the backlog.",
]

// 5x7 pixel font bitmaps
const PIXEL_FONT: Record<string, number[]> = {
  '4': [0,0,1,0,0, 0,1,1,0,0, 1,0,1,0,0, 1,1,1,1,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
  '0': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,1,1, 1,0,1,0,1, 1,1,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  'A': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1],
  'B': [1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0],
  'C': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,1, 0,1,1,1,0],
  'D': [1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0],
  'E': [1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1],
  'F': [1,1,1,1,1, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0],
  'G': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,0, 1,0,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  'H': [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1],
  'I': [1,1,1,1,1, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 1,1,1,1,1],
  'K': [1,0,0,0,1, 1,0,0,1,0, 1,0,1,0,0, 1,1,0,0,0, 1,0,1,0,0, 1,0,0,1,0, 1,0,0,0,1],
  'L': [1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0, 1,1,1,1,1],
  'M': [1,0,0,0,1, 1,1,0,1,1, 1,0,1,0,1, 1,0,1,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1],
  'N': [1,0,0,0,1, 1,1,0,0,1, 1,0,1,0,1, 1,0,0,1,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1],
  'O': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  'P': [1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0, 1,0,0,0,0, 1,0,0,0,0, 1,0,0,0,0],
  'R': [1,1,1,1,0, 1,0,0,0,1, 1,0,0,0,1, 1,1,1,1,0, 1,0,1,0,0, 1,0,0,1,0, 1,0,0,0,1],
  'S': [0,1,1,1,0, 1,0,0,0,1, 1,0,0,0,0, 0,1,1,1,0, 0,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  'T': [1,1,1,1,1, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
  'U': [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 0,1,1,1,0],
  'W': [1,0,0,0,1, 1,0,0,0,1, 1,0,0,0,1, 1,0,1,0,1, 1,0,1,0,1, 1,1,0,1,1, 1,0,0,0,1],
  'X': [1,0,0,0,1, 1,0,0,0,1, 0,1,0,1,0, 0,0,1,0,0, 0,1,0,1,0, 1,0,0,0,1, 1,0,0,0,1],
  'Y': [1,0,0,0,1, 1,0,0,0,1, 0,1,0,1,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0],
  ' ': [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0],
  '.': [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,1,0,0,0],
  '!': [0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,1,0,0],
  '?': [0,1,1,1,0, 1,0,0,0,1, 0,0,0,0,1, 0,0,1,1,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,1,0,0],
  '-': [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 1,1,1,1,1, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0],
  '\'': [0,0,1,0,0, 0,0,1,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0],
  ',': [0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,0,0,0, 0,0,1,0,0, 0,1,0,0,0],
  '[': [0,1,1,0,0, 0,1,0,0,0, 0,1,0,0,0, 0,1,0,0,0, 0,1,0,0,0, 0,1,0,0,0, 0,1,1,0,0],
  ']': [0,0,1,1,0, 0,0,0,1,0, 0,0,0,1,0, 0,0,0,1,0, 0,0,0,1,0, 0,0,0,1,0, 0,0,1,1,0],
  '>': [1,0,0,0,0, 0,1,0,0,0, 0,0,1,0,0, 0,0,0,1,0, 0,0,1,0,0, 0,1,0,0,0, 1,0,0,0,0],
}

const PURPLE_PALETTE = [
  '#c084fc', '#a855f7', '#9333ea', '#7e22ce',
  '#6b21a8', '#d8b4fe', '#e9d5ff', '#8b5cf6',
]

interface Particle {
  x: number
  y: number
  targetX: number
  targetY: number
  vx: number
  vy: number
  size: number
  color: string
  alpha: number
  delay: number
  trail: { x: number; y: number; alpha: number }[]
  isDecor?: boolean
}

// Background ripple — water drop pulse effect
interface Ripple {
  x: number
  y: number
  radius: number
  maxRadius: number
  speed: number
  pixelSize: number
  color: string
  born: number
}

function getTextPixels(text: string, pixelSize: number, centerX: number, centerY: number) {
  const chars = text.toUpperCase().split('')
  const charW = 5
  const charH = 7
  const gap = 1
  const totalW = chars.length * (charW + gap) - gap
  const startX = centerX - (totalW * pixelSize) / 2
  const startY = centerY - (charH * pixelSize) / 2

  const pixels: { x: number; y: number }[] = []

  chars.forEach((char, ci) => {
    const bitmap = PIXEL_FONT[char]
    if (!bitmap) return
    for (let row = 0; row < charH; row++) {
      for (let col = 0; col < charW; col++) {
        if (bitmap[row * charW + col]) {
          pixels.push({
            x: startX + (ci * (charW + gap) + col) * pixelSize,
            y: startY + row * pixelSize,
          })
        }
      }
    }
  })

  return pixels
}

// Draw pixel text directly on canvas (for the message and button)
function drawPixelText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  centerY: number,
  pixelSize: number,
  color: string,
  alpha: number = 1
) {
  const chars = text.toUpperCase().split('')
  const charW = 5
  const charH = 7
  const gap = 1
  const totalW = chars.length * (charW + gap) - gap
  const startX = centerX - (totalW * pixelSize) / 2
  const startY = centerY - (charH * pixelSize) / 2

  ctx.globalAlpha = alpha
  ctx.fillStyle = color

  chars.forEach((char, ci) => {
    const bitmap = PIXEL_FONT[char]
    if (!bitmap) return
    for (let row = 0; row < charH; row++) {
      for (let col = 0; col < charW; col++) {
        if (bitmap[row * charW + col]) {
          const px = startX + (ci * (charW + gap) + col) * pixelSize
          const py = startY + row * pixelSize
          ctx.fillRect(
            Math.round(px / 2) * 2,
            Math.round(py / 2) * 2,
            pixelSize,
            pixelSize
          )
        }
      }
    }
  })

  ctx.globalAlpha = 1
}

function PixelDimension({ onExit }: { onExit: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
  const ripplesRef = useRef<Ripple[]>([])
  const lastRippleRef = useRef<number>(0)
  const frameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  const phaseRef = useRef<'explode' | 'drift' | 'assemble' | 'settled'>('explode')
  const messageIndexRef = useRef(Math.floor(Math.random() * glitches.length))
  const messageFadeRef = useRef(1)
  const messageTimerRef = useRef(0)
  const buttonHoverRef = useRef(false)
  const buttonRectRef = useRef({ x: 0, y: 0, w: 0, h: 0 })

  const init = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const cx = canvas.width / 2
    const cy = canvas.height * 0.35
    const pixelSize = Math.max(5, Math.min(8, canvas.width / 100))

    const targets = getTextPixels('404', pixelSize, cx, cy)
    const particles: Particle[] = targets.map((target, i) => {
      const angle = Math.random() * Math.PI * 2
      const speed = 8 + Math.random() * 16
      return {
        x: cx,
        y: cy,
        targetX: target.x,
        targetY: target.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: pixelSize,
        color: PURPLE_PALETTE[Math.floor(Math.random() * PURPLE_PALETTE.length)],
        alpha: 1,
        delay: i * 2,
        trail: [],
      }
    })

    // Decorative particles that float around
    for (let i = 0; i < 60; i++) {
      const angle = Math.random() * Math.PI * 2
      const speed = 4 + Math.random() * 12
      particles.push({
        x: cx,
        y: cy,
        targetX: cx + (Math.random() - 0.5) * canvas.width * 0.8,
        targetY: cy + (Math.random() - 0.5) * canvas.height * 0.6,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: pixelSize * (0.3 + Math.random() * 0.4),
        color: PURPLE_PALETTE[Math.floor(Math.random() * PURPLE_PALETTE.length)],
        alpha: 0.4 + Math.random() * 0.3,
        delay: Math.random() * 80,
        trail: [],
        isDecor: true,
      })
    }

    // Seed a few initial ripples at different stages
    const ripples: Ripple[] = []
    for (let i = 0; i < 4; i++) {
      const maxR = 80 + Math.random() * 160
      ripples.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: maxR * (0.2 + Math.random() * 0.6),
        maxRadius: maxR,
        speed: 0.3 + Math.random() * 0.4,
        pixelSize: 2,
        color: PURPLE_PALETTE[Math.floor(Math.random() * PURPLE_PALETTE.length)],
        born: performance.now() - Math.random() * 3000,
      })
    }

    particlesRef.current = particles
    ripplesRef.current = ripples
    startTimeRef.current = performance.now()
    phaseRef.current = 'explode'
    messageTimerRef.current = performance.now()
  }, [])

  useEffect(() => {
    init()
    const handleResize = () => init()
    window.addEventListener('resize', handleResize)

    const animate = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const now = performance.now()
      const elapsed = now - startTimeRef.current
      const particles = particlesRef.current
      const ripples = ripplesRef.current

      // Phase transitions
      if (elapsed > 1000 && phaseRef.current === 'explode') phaseRef.current = 'drift'
      if (elapsed > 2200 && phaseRef.current === 'drift') phaseRef.current = 'assemble'
      if (elapsed > 4000 && phaseRef.current === 'assemble') phaseRef.current = 'settled'

      // Message cycling (every 3s)
      if (phaseRef.current === 'settled') {
        const msgElapsed = now - messageTimerRef.current
        if (msgElapsed > 3000) {
          messageTimerRef.current = now
          messageFadeRef.current = 0
          let next = messageIndexRef.current
          while (next === messageIndexRef.current) {
            next = Math.floor(Math.random() * glitches.length)
          }
          messageIndexRef.current = next
        }
        // Fade in/out
        const msgPhase = now - messageTimerRef.current
        if (msgPhase < 300) {
          messageFadeRef.current = msgPhase / 300
        } else if (msgPhase > 2700) {
          messageFadeRef.current = 1 - (msgPhase - 2700) / 300
        } else {
          messageFadeRef.current = 1
        }
      }

      // Background — deep space
      ctx.fillStyle = '#050510'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Subtle vignette
      const vignette = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, canvas.height * 0.3,
        canvas.width / 2, canvas.height / 2, canvas.height * 0.9
      )
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)')
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Scanlines
      ctx.fillStyle = 'rgba(255, 255, 255, 0.012)'
      for (let y = 0; y < canvas.height; y += 3) {
        ctx.fillRect(0, y, canvas.width, 1)
      }

      // Spawn new ripples periodically
      if (now - lastRippleRef.current > 600 + Math.random() * 800) {
        lastRippleRef.current = now
        ripples.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: 0,
          maxRadius: 60 + Math.random() * 180,
          speed: 0.3 + Math.random() * 0.5,
          pixelSize: 2,
          color: PURPLE_PALETTE[Math.floor(Math.random() * PURPLE_PALETTE.length)],
          born: now,
        })
      }

      // Draw ripples — concentric pixel rings expanding outward
      for (let i = ripples.length - 1; i >= 0; i--) {
        const ripple = ripples[i]
        ripple.radius += ripple.speed

        // Remove dead ripples
        if (ripple.radius > ripple.maxRadius) {
          ripples.splice(i, 1)
          continue
        }

        const life = ripple.radius / ripple.maxRadius
        const fadeIn = Math.min(1, ripple.radius / 20)
        const fadeOut = 1 - life
        const alpha = fadeIn * fadeOut * 0.35

        // Draw 2-3 concentric rings at different radii
        const ringCount = 3
        for (let ring = 0; ring < ringCount; ring++) {
          const ringRadius = ripple.radius * (1 - ring * 0.3)
          if (ringRadius <= 0) continue
          const ringAlpha = alpha * (1 - ring * 0.35)

          ctx.fillStyle = ripple.color
          ctx.globalAlpha = Math.max(0, ringAlpha)

          // Draw pixelated circle using discrete points
          const circumference = Math.PI * 2 * ringRadius
          const steps = Math.max(8, Math.floor(circumference / (ripple.pixelSize * 1.8)))

          for (let s = 0; s < steps; s++) {
            const angle = (s / steps) * Math.PI * 2
            const px = ripple.x + Math.cos(angle) * ringRadius
            const py = ripple.y + Math.sin(angle) * ringRadius
            ctx.fillRect(
              Math.round(px / ripple.pixelSize) * ripple.pixelSize,
              Math.round(py / ripple.pixelSize) * ripple.pixelSize,
              ripple.pixelSize,
              ripple.pixelSize
            )
          }
        }

        // Draw a bright center dot when the ripple is young
        if (life < 0.15) {
          const dotAlpha = (1 - life / 0.15) * 0.6
          ctx.globalAlpha = dotAlpha
          ctx.fillStyle = '#e9d5ff'
          const dotSize = ripple.pixelSize * 2
          ctx.fillRect(
            Math.round(ripple.x / ripple.pixelSize) * ripple.pixelSize - dotSize / 2,
            Math.round(ripple.y / ripple.pixelSize) * ripple.pixelSize - dotSize / 2,
            dotSize,
            dotSize
          )
        }
      }
      ctx.globalAlpha = 1

      // Particles
      particles.forEach((p) => {
        if (elapsed < p.delay) return

        p.trail.push({ x: p.x, y: p.y, alpha: p.alpha * 0.5 })
        if (p.trail.length > 5) p.trail.shift()

        switch (phaseRef.current) {
          case 'explode':
            p.x += p.vx
            p.y += p.vy
            p.vx *= 0.96
            p.vy *= 0.96
            p.vy += 0.12
            break
          case 'drift':
            p.x += p.vx * 0.3
            p.y += p.vy * 0.3
            p.vx *= 0.95
            p.vy *= 0.95
            p.x += Math.sin(elapsed * 0.002 + p.delay) * 0.3
            p.y += Math.cos(elapsed * 0.003 + p.delay) * 0.3
            break
          case 'assemble': {
            const dx = p.targetX - p.x
            const dy = p.targetY - p.y
            p.vx = (p.vx + dx * 0.08) * 0.82
            p.vy = (p.vy + dy * 0.08) * 0.82
            p.x += p.vx
            p.y += p.vy
            break
          }
          case 'settled': {
            if (p.isDecor) {
              // Decor particles orbit gently
              p.x += Math.sin(elapsed * 0.001 + p.delay) * 0.4
              p.y += Math.cos(elapsed * 0.0015 + p.delay) * 0.3
              p.alpha = 0.15 + Math.sin(elapsed * 0.002 + p.delay) * 0.15
            } else {
              const sdx = p.targetX - p.x
              const sdy = p.targetY - p.y
              p.x += sdx * 0.15
              p.y += sdy * 0.15
              // Gentle breathing
              p.x += Math.sin(elapsed * 0.003 + p.delay * 0.1) * 0.3
            }
            break
          }
        }

        // Trail
        p.trail.forEach((t, ti) => {
          ctx.fillStyle = p.color
          ctx.globalAlpha = (ti / p.trail.length) * 0.12
          const s = p.size * (0.4 + (ti / p.trail.length) * 0.6)
          ctx.fillRect(Math.round(t.x / 2) * 2, Math.round(t.y / 2) * 2, s, s)
        })

        // Pixel
        ctx.globalAlpha = p.alpha
        ctx.fillStyle = p.color
        const sx = Math.round(p.x / 2) * 2
        const sy = Math.round(p.y / 2) * 2
        ctx.fillRect(sx, sy, p.size, p.size)

        // Highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
        ctx.fillRect(sx, sy, p.size * 0.4, p.size * 0.4)
        ctx.globalAlpha = 1
      })

      // UI elements (after particles settle)
      if (phaseRef.current === 'settled') {
        const cx = canvas.width / 2
        const msgY = canvas.height * 0.55
        const pixelSize = Math.max(2, Math.min(3, canvas.width / 250))

        // Quirky message
        const msg = glitches[messageIndexRef.current]
        // Truncate for pixel rendering (max ~40 chars look good)
        const displayMsg = msg.length > 40 ? msg.substring(0, 38) + '..' : msg
        drawPixelText(ctx, displayMsg, cx, msgY, pixelSize, '#a78bfa', messageFadeRef.current * 0.8)

        // "Take me home" button
        const btnY = canvas.height * 0.65
        const btnPixelSize = Math.max(2, Math.min(3, canvas.width / 280))
        const btnText = '[ TAKE ME HOME ]'
        const btnCharW = 5
        const gap = 1
        const btnTextW = btnText.length * (btnCharW + gap) * btnPixelSize
        const btnPadX = btnPixelSize * 4
        const btnPadY = btnPixelSize * 3
        const btnH = 7 * btnPixelSize + btnPadY * 2
        const btnW = btnTextW + btnPadX * 2
        const btnX = cx - btnW / 2
        const btnYTop = btnY - 7 * btnPixelSize / 2 - btnPadY

        buttonRectRef.current = { x: btnX, y: btnYTop, w: btnW, h: btnH }

        // Button border (pixel style)
        const borderColor = buttonHoverRef.current ? '#c084fc' : '#7c3aed'
        const fillColor = buttonHoverRef.current ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.08)'
        ctx.fillStyle = fillColor
        ctx.fillRect(
          Math.round(btnX / 2) * 2,
          Math.round(btnYTop / 2) * 2,
          Math.round(btnW / 2) * 2,
          Math.round(btnH / 2) * 2
        )

        // Pixel border
        const bSize = Math.max(2, btnPixelSize)
        ctx.fillStyle = borderColor
        ctx.globalAlpha = buttonHoverRef.current ? 0.9 : 0.6
        // Top & bottom
        for (let x = btnX; x < btnX + btnW; x += bSize) {
          ctx.fillRect(Math.round(x / 2) * 2, Math.round(btnYTop / 2) * 2, bSize, bSize)
          ctx.fillRect(Math.round(x / 2) * 2, Math.round((btnYTop + btnH - bSize) / 2) * 2, bSize, bSize)
        }
        // Left & right
        for (let y = btnYTop; y < btnYTop + btnH; y += bSize) {
          ctx.fillRect(Math.round(btnX / 2) * 2, Math.round(y / 2) * 2, bSize, bSize)
          ctx.fillRect(Math.round((btnX + btnW - bSize) / 2) * 2, Math.round(y / 2) * 2, bSize, bSize)
        }
        ctx.globalAlpha = 1

        drawPixelText(
          ctx,
          btnText,
          cx,
          btnY,
          btnPixelSize,
          buttonHoverRef.current ? '#e9d5ff' : '#c084fc',
          buttonHoverRef.current ? 1 : 0.8
        )

        // "Click logo to exit" hint
        const hintY = canvas.height * 0.75
        const blink = Math.sin(elapsed * 0.003) > 0
        if (blink) {
          drawPixelText(ctx, '> CLICK LOGO TO EXIT <', cx, hintY, 2, '#6b21a8', 0.4)
        }

        // Pulsing pixel logo placeholder at top
        const logoY = canvas.height * 0.2
        const logoSize = Math.max(3, Math.min(5, canvas.width / 160))
        const logoPulse = 0.6 + Math.sin(elapsed * 0.004) * 0.4
        // Simple concentric circle pixel art (like the Pulse logo)
        const logoPattern = [
          [0,0,0,1,1,1,0,0,0],
          [0,0,1,0,0,0,1,0,0],
          [0,1,0,0,0,0,0,1,0],
          [1,0,0,0,1,0,0,0,1],
          [1,0,0,1,1,1,0,0,1],
          [1,0,0,0,1,0,0,0,1],
          [0,1,0,0,0,0,0,1,0],
          [0,0,1,0,0,0,1,0,0],
          [0,0,0,1,1,1,0,0,0],
        ]
        const logoW = logoPattern[0].length
        const logoH = logoPattern.length
        const logoStartX = cx - (logoW * logoSize) / 2
        const logoStartY = logoY - (logoH * logoSize) / 2

        logoPattern.forEach((row, ry) => {
          row.forEach((pixel, rx) => {
            if (pixel) {
              const px = logoStartX + rx * logoSize
              const py = logoStartY + ry * logoSize
              // Gradient from purple to lighter
              const colorIdx = Math.floor((ry / logoH) * PURPLE_PALETTE.length)
              ctx.fillStyle = PURPLE_PALETTE[colorIdx]
              ctx.globalAlpha = logoPulse
              ctx.fillRect(
                Math.round(px / 2) * 2,
                Math.round(py / 2) * 2,
                logoSize,
                logoSize
              )
            }
          })
        })
        ctx.globalAlpha = 1
      }

      frameRef.current = requestAnimationFrame(animate)
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('resize', handleResize)
    }
  }, [init])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Spawn a ripple where the user clicks
    ripplesRef.current.push({
      x, y,
      radius: 0,
      maxRadius: 120 + Math.random() * 100,
      speed: 0.6,
      pixelSize: 2,
      color: '#d8b4fe',
      born: performance.now(),
    })

    // Check button click
    const btn = buttonRectRef.current
    if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
      window.location.href = '/'
      return
    }

    // Check logo click (top area) to exit
    const canvas = canvasRef.current
    if (!canvas) return
    const logoY = canvas.height * 0.2
    const logoSize = Math.max(3, Math.min(5, canvas.width / 160)) * 9
    const cx = canvas.width / 2
    if (
      Math.abs(x - cx) < logoSize / 2 + 20 &&
      Math.abs(y - logoY) < logoSize / 2 + 20
    ) {
      onExit()
    }
  }, [onExit])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const btn = buttonRectRef.current
    const isHover = x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h

    // Check logo hover too
    const canvas = canvasRef.current
    if (!canvas) {
      buttonHoverRef.current = isHover
      return
    }
    const logoY = canvas.height * 0.2
    const logoSize = Math.max(3, Math.min(5, canvas.width / 160)) * 9
    const cx = canvas.width / 2
    const isLogoHover = Math.abs(x - cx) < logoSize / 2 + 20 && Math.abs(y - logoY) < logoSize / 2 + 20

    if (canvasRef.current) {
      const pixelPointer = `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='21' height='24' viewBox='0 0 21 24'><rect x='6' y='0' width='3' height='3' fill='%23e9d5ff'/><rect x='3' y='3' width='3' height='3' fill='%23e9d5ff'/><rect x='6' y='3' width='3' height='3' fill='%23e9d5ff'/><rect x='0' y='6' width='3' height='3' fill='%23e9d5ff'/><rect x='3' y='6' width='3' height='3' fill='%23e9d5ff'/><rect x='6' y='6' width='3' height='3' fill='%23e9d5ff'/><rect x='0' y='9' width='3' height='3' fill='%23e9d5ff'/><rect x='3' y='9' width='3' height='3' fill='%23e9d5ff'/><rect x='6' y='9' width='3' height='3' fill='%23e9d5ff'/><rect x='9' y='9' width='3' height='3' fill='%23e9d5ff'/><rect x='12' y='9' width='3' height='3' fill='%23e9d5ff'/><rect x='0' y='12' width='3' height='3' fill='%23e9d5ff'/><rect x='3' y='12' width='3' height='3' fill='%23e9d5ff'/><rect x='6' y='12' width='3' height='3' fill='%23e9d5ff'/><rect x='9' y='12' width='3' height='3' fill='%23e9d5ff'/><rect x='12' y='12' width='3' height='3' fill='%23e9d5ff'/><rect x='15' y='12' width='3' height='3' fill='%23e9d5ff'/><rect x='18' y='12' width='3' height='3' fill='%23e9d5ff'/><rect x='0' y='15' width='3' height='3' fill='%23e9d5ff'/><rect x='3' y='15' width='3' height='3' fill='%23e9d5ff'/><rect x='0' y='18' width='3' height='3' fill='%23e9d5ff'/><rect x='3' y='18' width='3' height='3' fill='%23e9d5ff'/></svg>") 3 0, pointer`
      canvasRef.current.style.cursor = (isHover || isLogoHover) ? pixelPointer : ''
    }
    buttonHoverRef.current = isHover
  }, [])

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-50"
      style={{
        imageRendering: 'pixelated',
        cursor: `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><rect x='0' y='0' width='3' height='3' fill='%23c084fc'/><rect x='0' y='3' width='3' height='3' fill='%23c084fc'/><rect x='0' y='6' width='3' height='3' fill='%23c084fc'/><rect x='0' y='9' width='3' height='3' fill='%23c084fc'/><rect x='0' y='12' width='3' height='3' fill='%23c084fc'/><rect x='0' y='15' width='3' height='3' fill='%23c084fc'/><rect x='0' y='18' width='3' height='3' fill='%23c084fc'/><rect x='3' y='3' width='3' height='3' fill='%23c084fc'/><rect x='3' y='12' width='3' height='3' fill='%23c084fc'/><rect x='6' y='6' width='3' height='3' fill='%23c084fc'/><rect x='6' y='12' width='3' height='3' fill='%23c084fc'/><rect x='9' y='9' width='3' height='3' fill='%23c084fc'/><rect x='9' y='12' width='3' height='3' fill='%23c084fc'/><rect x='12' y='12' width='3' height='3' fill='%23c084fc'/><rect x='15' y='15' width='3' height='3' fill='%23c084fc'/><rect x='18' y='18' width='3' height='3' fill='%23c084fc'/></svg>") 0 0, auto`,
      }}
    />
  )
}

export default function NotFound() {
  const [index, setIndex] = useState(0)
  const [fade, setFade] = useState(true)
  const [pixelDimension, setPixelDimension] = useState(false)

  useEffect(() => {
    setIndex(Math.floor(Math.random() * glitches.length))
  }, [])

  useEffect(() => {
    if (pixelDimension) return

    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIndex((prev) => {
          let next = prev
          while (next === prev) {
            next = Math.floor(Math.random() * glitches.length)
          }
          return next
        })
        setFade(true)
      }, 200)
    }, 3000)

    return () => clearInterval(interval)
  }, [pixelDimension])

  if (pixelDimension) {
    return <PixelDimension onExit={() => setPixelDimension(false)} />
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="flex max-w-md flex-col items-center gap-6 text-center">
        <button
          onClick={() => setPixelDimension(true)}
          className="cursor-pointer border-none bg-transparent p-0"
          aria-label="Enter the pixel dimension"
        >
          <Image
            src="/pulse-logo.png"
            alt="Pulse"
            width={56}
            height={56}
            className="animate-pulse transition-transform hover:scale-110"
          />
        </button>

        <div className="flex flex-col gap-2">
          <p className="font-mono text-6xl font-bold tracking-tighter text-foreground/20">
            404
          </p>
          <p
            className="h-12 text-base text-muted-foreground transition-opacity duration-200"
            style={{ opacity: fade ? 1 : 0 }}
          >
            {glitches[index]}
          </p>
        </div>

        <Button asChild variant="outline" size="sm">
          <Link href="/">Take me home</Link>
        </Button>
      </div>
    </div>
  )
}

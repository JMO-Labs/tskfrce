import '@testing-library/jest-dom/jest-globals'
import { configure } from '@testing-library/react'

// findBy/waitFor under a loaded CI box: the default 1 s is too tight for Mantine menus and dialogs
configure({ asyncUtilTimeout: 4000 })
import fs from 'fs'
import path from 'path'

// Load CSS files into the DOM for testing
const parentTokensCss = fs.readFileSync(
  path.join(__dirname, 'src/v2/parent/parent-tokens.css'),
  'utf8'
)
const motionCss = fs.readFileSync(
  path.join(__dirname, 'src/v2/parent/motion.css'),
  'utf8'
)

// Inject styles into document head (skipped in @jest-environment node tests)
if (typeof document !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = parentTokensCss + '\n' + motionCss
  document.head.appendChild(style)

  // Also set CSS custom properties directly on the root element for getComputedStyle to work
  document.documentElement.style.setProperty('--dur-1', '150ms')
  document.documentElement.style.setProperty('--dur-2', '250ms')
  document.documentElement.style.setProperty('--ease-out', 'cubic-bezier(0.25, 0.46, 0.45, 0.94)')
}

// jsdom lacks these; SummaryRow, InfoPop and Mantine need them
if (typeof window !== 'undefined') {
  window.matchMedia ??= (q) => ({ matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })
  Element.prototype.scrollIntoView ??= () => {}
}

// Mock Next.js router
jest.mock('next/router', () => ({
  useRouter() {
    return {
      route: '/',
      pathname: '/',
      query: {},
      asPath: '/',
      push: jest.fn(),
      replace: jest.fn(),
      back: jest.fn(),
      prefetch: jest.fn().mockResolvedValue(undefined),
      events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
      isFallback: false,
    }
  },
}))

// Mantine's SegmentedControl measures itself; jsdom has no ResizeObserver
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
}

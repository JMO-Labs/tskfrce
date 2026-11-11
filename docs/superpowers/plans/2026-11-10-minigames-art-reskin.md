# Minigames art reskin – PixiJS + Fluent emoji + Rive mascots

Status: implementation plan, 2026-11-10. Owner approved mockup. This is the art and animation layer for phase 1 games: Hungry Cat, Math Dash, Pack the Box, Shelf Memory (PixiJS), plus new Fluent 3D emoji and Kenney art, and Rive mascot integration with CSS-SVG fallback.

## Why

Phase 1 games need production art and feel. The approved mockup shows the new look: PixiJS canvas for action games gives clean motion and game feel (squash, sparkle, shake, floating damage). Fluent 3D emoji and Kenney art keep art asset load low (no custom drawings in phase 1) and self-hosted (no CDN, boxes offline). Rive mascots animate state transitions; CSS-SVG fallback works until .riv files drop in.

## Goals

1. Move Hungry Cat, Math Dash, Pack the Box, Shelf Memory to PixiJS v8 (lazy-loaded).
2. Bundle and self-host Fluent 3D PNGs and Kenney sprites; no CDN.
3. Rive mascot integration with documented .riv contract and CSS-SVG fallback.
4. Game feel: squash on catch, sparkle burst, +N floats, screen shake on miss, speed ramp.
5. Phone perf: 60fps mid-devices, cap DPR at 2, destroy Pixi app on unmount, pause on visibilitychange.
6. Respect prefers-reduced-motion; honor kid's Celebrations setting (Off/Small/Full).

## How: four gates

### 1. Prep (headless)

- Identify which Fluent 3D PNGs and Kenney sprites each game needs.
- Download, optimize (128px webp/png), and vendor into `frontend/public/art/fluent/` and `frontend/public/art/kenney/`.
- Write licenses/credits file entry (Fluent MIT, Kenney CC0).
- Add `@rive-app/react-canvas` (or canvas-lite) to package.json; do NOT import yet (lazy-load only).
- Define .riv contract in markdown: artboard name, state machine inputs (cheer, wince, dance).

### 2. Build (PixiJS games)

- Hungry Cat: cat slides, food falls + speeds up, socks to dodge, +N points floats, sparkle burst on catch, screen shake on sock.
- Math Dash: numbers/operators on canvas, tap to pick answer, squash feedback.
- Pack the Box: shapes on canvas, slide to fit, tighter each level, squash on place.
- Shelf Memory: items shown then hidden, tap to recall, sparkle on correct, wince on wrong.
- Each is its own module; share `PixiApp` helper (init, cleanup, pause on hidden).
- Keep game logic (scoring, state) in pure TS, testable without Pixi. Pixi layer thin.

### 3. Test + motion

- TDD: game logic tests pass.
- Headless Chrome screenshots: each game at phone width vs mockup. Fix drift.
- Motion: test prefers-reduced-motion and Celebrations OFF/Small/Full. Squash and shake respect it.

### 4. Polish + CI

- 5 passes: look (colors, spacing, emoji clarity), feel (timing, easing, feedback), perf (FPS, memory, unmount cleanup), a11y (focus, reduced motion), mobile (touch latency, DPR).
- Local CI: `npm ci`, lint, tsc, jest, build.
- Bundle analysis: kid shell vs lazy Pixi chunks. Report delta.

## Files

| File | Lines | Role |
|------|-------|------|
| `frontend/src/v2/games/PixiApp.ts` | <100 | Init, cleanup, pause on visibility |
| `frontend/src/v2/games/hungryCat/HungryCat.tsx` | <200 | Component wrapper (lazy Pixi) |
| `frontend/src/v2/games/hungryCat/logic.ts` | <100 | Scoring and state (testable) |
| `frontend/src/v2/games/hungryCat/render.ts` | <250 | Pixi render loop and sprites |
| `frontend/src/v2/games/mathDash/MathDash.tsx` | <150 | Component, lazy Pixi |
| `frontend/src/v2/games/mathDash/render.ts` | <200 | Canvas, text, tapping |
| Similar for packBox, shelfMemory | ... | ... |
| `frontend/src/v2/games/Mascot.tsx` | <150 | Rive + CSS-SVG fallback |
| `frontend/src/v2/games/mascot.ts` | <50 | .riv contract, fallback render |
| `frontend/public/art/fluent/*.png` | – | Vendored Fluent PNGs (optimized) |
| `frontend/public/art/kenney/*` | – | Kenney sprites (optimized) |
| `LICENSES.md` | <50 | Fluent MIT, Kenney CC0 |

## .riv contract

Rive file must have:
- Artboard: `mascot`
- State machine: `states`
- Inputs (booleans): `cheer`, `wince`, `dance`

If file is absent, CSS-SVG fallback (animate existing SVGs with keyframes).

## Not in scope

- Custom drawn art per game (deferred).
- Audio.
- Minigame upgrades and power-ups (PR 2).
- Teen Trivia and phase 2 thinking games.
- Parent and settings screens (deferred).

## Success

- All 4 games move to Pixi, run at 60fps on mid-devices.
- Fluent emoji + Kenney art render cleanly, no CDN.
- Mascot cheers/winces/dances (or CSS-SVG equivalent).
- Bundle delta: kid shell <10KB heavier; Pixi chunks lazy-loaded at game open.
- No regressions on main: CI passes, quick-fire games untouched.
- Screenshots match mockup; prefers-reduced-motion and Celebrations OFF both work.

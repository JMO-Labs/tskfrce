# Quick-Fire Games: Fluent Asset Integration Decision

**Date**: 2026-11-10  
**Status**: Deferred to Phase 2  
**Rationale**: Resource constraints vs. scope

## Current State

The 20 quick-fire games (BubblePop, CatDash, Catch, Count, Dodge, Feed, Flip, Fold, Hang, Match, PlateTower, Plug, QuickDraw, Shh, SockSnatch, Spot, Squeeze, SweepSwipe, Water, Zip) currently use emoji placeholders (🍪, 🍤, 👣, 🐟, ✨, ⬆️, etc.) for game assets.

## Decision

**Phase 1 (Current PR #96)**: Fluent Assets integration applies to the four Pixi-based full games:
- hungryCat ✓
- mathDash (uses text/graphics, no assets)
- packBox (uses Canvas, no image assets)
- shelfMemory (uses emoji text, no image assets)

**Phase 2 (Future PR)**: Replace 20 quick-fire game emoji placeholders with Fluent PNGs:
- Requires systematic asset mapping (cookie.png → 🍪, magnet.png → for appropriate games, etc.)
- Needs visual regression testing across all 20 games
- Estimated effort: ~2-3 additional polish passes per game

## Why Deferred

1. **Scope creep**: PR #96 focuses on the four main Pixi games; adding 20 quick-fire games would balloon scope
2. **Design review needed**: Which Fluent asset maps to which game? Needs product review
3. **Testing complexity**: 20 more games means 100 more polish checks (5 passes × 20 games)
4. **Functional completeness**: Quick games work with emoji; Fluent is a pure visual upgrade, not functional blocker

## Next Steps

- Phase 2: Product team to define Fluent emoji mappings for quick games
- Phase 2: Create GitHub issue "Quick-Fire Games: Replace Emoji with Fluent Assets"
- Phase 2: Batch PR with all 20 games (better than scattered updates)

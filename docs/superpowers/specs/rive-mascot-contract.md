# Rive Mascot Animation Contract

## Overview
This document defines the contract between the mascot animation system and Rive animation files (.riv format). It specifies the artboard structure, state machine configuration, and input names that all mascot animation files must implement.

## Artboard Specification
- **Artboard Name:** `mascot`
  - The primary artboard containing the mascot character animation
  - All animations must be contained within this artboard
  - Default entry point for animation playback

## State Machine Specification
- **State Machine Name:** `states`
  - Controls the behavioral states of the mascot
  - Receives input from boolean state triggers
  - Manages transitions between different animation states

## Input Specification
The state machine must expose three boolean inputs for controlling mascot behavior:

### 1. `cheer` (boolean)
- **Purpose:** Trigger celebration/positive animation
- **Values:** true (activate), false (deactivate)
- **Duration:** Animation plays until explicitly set to false or naturally completes
- **Behavior:** Plays upbeat, celebratory animation (e.g., jump, cheer, confetti-adjacent pose)

### 2. `wince` (boolean)
- **Purpose:** Trigger pain/negative response animation
- **Values:** true (activate), false (deactivate)
- **Duration:** Animation plays until explicitly set to false or naturally completes
- **Behavior:** Plays distressed animation (e.g., flinch, grimace, retreat)

### 3. `dance` (boolean)
- **Purpose:** Trigger rhythmic idle animation
- **Values:** true (activate), false (deactivate)
- **Duration:** Animation loops while true, stops on false
- **Behavior:** Plays looping dance/rhythmic animation (e.g., sway, bop, gentle bounce)

## Fallback Behavior
If the `.riv` file is missing or fails to load:
1. The system falls back to CSS-SVG animation
2. Uses existing SVG mascot files at `/frontend/public/celebrate/mascots/*.svg`
3. Applies CSS animations (rotate, scale, opacity transitions) to replicate basic state changes
4. **cheer:** Scale up + rotate (celebrating pose)
5. **wince:** Scale down + opacity fade (pain response)
6. **dance:** Continuous rotate (rhythmic motion)

## Implementation Notes
- All state inputs are independent and can be combined (though order of precedence is implementation-dependent)
- Transition times between states should be smooth (150-250ms recommended)
- Idle state (all inputs false) shows a neutral, friendly pose
- State machine should handle rapid input changes gracefully without stuttering

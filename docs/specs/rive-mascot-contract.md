# Rive Mascot Animation Contract

## Overview

The Mascot component supports both Rive (.riv) animations and CSS-SVG fallback animations. When an owner drops a .riv file at `/celebrate/mascots/{name}.riv`, it must conform to this contract for the component to recognize and use it.

## .riv File Contract

When deploying a Rive animation file, it must meet these specifications:

### Required Artboard
- **Name**: `mascot`
- The component will load this artboard by default

### Required State Machine
- **Name**: `states`
- Must contain animation logic for all state transitions

### Required Boolean Inputs

The state machine must expose three boolean input controls:

| Input Name | Type | Purpose | Example |
|-----------|------|---------|---------|
| `cheer` | boolean | Trigger celebration/cheer animation | Victory, bonus points |
| `wince` | boolean | Trigger pain/wince animation | Penalty, mistake |
| `dance` | boolean | Trigger happy/dance animation | Special achievement |

#### Input Behavior
- Set the corresponding input to `true` to trigger the animation
- Only one input should be `true` at a time
- When transitioning between states, the previous input is set to `false` before activating the new one
- The component internally manages input state based on the `state` prop

## File Location

All .riv files must be placed at:
```
/celebrate/mascots/{name}.riv
```

**Example**: `/celebrate/mascots/cat-princess.riv`

## SVG Fallback

If the .riv file is unavailable or fails to load, the component automatically falls back to CSS-SVG animations:

### Fallback Animation States
- **idle**: No animation
- **cheer**: Scale 0.9 → 1.1 → 1 with upward bounce (-10px)
- **wince**: Left-right shake with opacity dip (0.8)
- **dance**: 360° rotation with vertical bob (-20px)

All CSS animations respect `prefers-reduced-motion` media query and will skip animations when the user has motion reduction enabled.

## Component Integration

### Props
```typescript
interface MascotProps {
  state: 'idle' | 'cheer' | 'wince' | 'dance'
  mascotSvg: string  // Path to SVG fallback
  name?: string      // Mascot name (for .riv file path)
  className?: string // Optional CSS class
}
```

### Usage Example
```tsx
import { Mascot } from '@/v2/games/Mascot'

export function GameComponent() {
  const [state, setState] = useState<'idle' | 'cheer'>('idle')
  
  return (
    <Mascot
      state={state}
      mascotSvg="/mascots/cat-princess.svg"
      name="cat-princess"
    />
  )
}
```

## Testing Requirements

When creating a new .riv file:
1. Verify the artboard is named exactly `mascot`
2. Verify the state machine is named exactly `states`
3. Test each input control in the Rive editor:
   - Set `cheer` to true → animation plays
   - Set `wince` to true → animation plays
   - Set `dance` to true → animation plays
4. Verify smooth transitions between states
5. Load in the component and verify it displays correctly

## Performance Considerations

- .riv files are fetched with a 5-second timeout
- If loading fails, the component silently falls back to CSS-SVG animations
- Rive canvas automatically respects `prefers-reduced-motion`

## Future Enhancements

- Additional animation states (smile, worried, surprised)
- State machine parameters for animation intensity
- Lip-sync support for audio playback

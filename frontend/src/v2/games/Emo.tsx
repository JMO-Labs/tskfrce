// Fluent 3D art (MIT, microsoft/fluentui-emoji) for game glyphs, served from the box.
// Sized in em so existing font-size CSS keeps working; unknown glyphs fall back to text.
const ART: Record<string, string> = {
  '⏰': 'alarm_clock', '🕰️': 'mantelpiece_clock', '🌊': 'water_wave', '🌱': 'seedling',
  '🍤': 'fried_shrimp', '🍲': 'pot_of_food', '🍽️': 'fork_and_knife_with_plate', '👕': 't_shirt',
  '👣': 'footprints', '💤': 'zzz', '📦': 'package', '🔑': 'key', '🤖': 'robot', '🥞': 'pancakes',
  '🧥': 'coat', '🧴': 'lotion_bottle', '🪣': 'bucket', '🪥': 'toothbrush',
};

export function emoArt(e: string): string | undefined {
  const f = ART[e];
  return f && `/art/fluent/${f}.webp`;
}

export function Emo({ e }: { e: string }) {
  const src = emoArt(e);
  if (!src) return <>{e}</>;
  // eslint-disable-next-line @next/next/no-img-element -- tiny static art, no optimizer on the box
  return <img src={src} alt="" aria-hidden width={128} height={128} draggable={false} style={{ width: '1em', height: '1em', verticalAlign: '-0.125em', display: 'inline-block' }} />;
}

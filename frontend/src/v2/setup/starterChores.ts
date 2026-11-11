/** Starter chores offered in the setup wizard (mockup 07): daily, with their chore type. */
export interface Starter {
  title: string
  type: string // built-in chore type name
  glyph: string
  points: number
  days?: number[] // weekdays Mon=0; omitted = every day
}

export const STARTER_CHORES_BY_AGE: Record<'little' | 'kid' | 'teen', Starter[]> = {
  little: [
    { title: 'Put toys away', type: 'Cleaning', glyph: 'toys', points: 10 },
    { title: 'Clothes in hamper', type: 'Personal', glyph: 'local_laundry_service', points: 8 },
    { title: 'Help set table', type: 'Kitchen', glyph: 'table_restaurant', points: 12 },
    { title: 'Make bed', type: 'Personal', glyph: 'bed', points: 10 },
  ],
  kid: [
    { title: 'Make bed', type: 'Personal', glyph: 'bed', points: 10 },
    { title: 'Tidy room', type: 'Cleaning', glyph: 'cleaning_services', points: 25 },
    { title: 'Set and clear table', type: 'Kitchen', glyph: 'table_restaurant', points: 18 },
    { title: 'Homework', type: 'Schoolwork', glyph: 'school', points: 30, days: [0, 1, 2, 3, 4] },
    { title: 'Take out trash', type: 'Kitchen', glyph: 'delete', points: 15 },
  ],
  teen: [
    { title: 'Do own laundry', type: 'Personal', glyph: 'local_laundry_service', points: 20 },
    { title: 'Load or unload dishes', type: 'Kitchen', glyph: 'restaurant', points: 20 },
    { title: 'Vacuum a room', type: 'Cleaning', glyph: 'cleaning_services', points: 30 },
    { title: 'Homework', type: 'Schoolwork', glyph: 'school', points: 30, days: [0, 1, 2, 3, 4] },
    { title: 'Help cook dinner', type: 'Kitchen', glyph: 'local_dining', points: 25 },
  ],
}

export const MORE_IDEAS_CHORES: Starter[] = [
  { title: 'Feed the pet', type: 'Pets', glyph: 'pets', points: 10 },
  { title: 'Water plants', type: 'Outdoor', glyph: 'yard', points: 10 },
  { title: 'Practice instrument', type: 'Practice', glyph: 'music_note', points: 15 },
]

// Backward compatibility
export const STARTER_CHORES: Starter[] = [
  ...STARTER_CHORES_BY_AGE.little,
  ...STARTER_CHORES_BY_AGE.kid,
  ...STARTER_CHORES_BY_AGE.teen,
  ...MORE_IDEAS_CHORES,
]

export const starter = (title: string): Starter | undefined => STARTER_CHORES.find((c) => c.title === title)

export const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐯', '🐵', '🐧', '🦖', '🚀', '⭐']
export const FLUENT_AVATAR_NAMES = ['fox', 'panda', 'lion', 'frog', 'octopus', 'unicorn', 'tiger', 'monkey', 'penguin', 't-rex', 'rocket', 'star']

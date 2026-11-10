import type { KidPlan, PresetCatalog } from '@/v2/presets/types'

const plan = (o: Partial<KidPlan> = {}): KidPlan => ({ chores: ['Make bed', 'Tidy room'], screen: 120, bedtime: '20:30', weekend: '22:00', lock: true, trust: false, photo: false, ...o })
const relaxedTeen = plan({ chores: ['Take out trash'], screen: 210, bedtime: '22:00', weekend: '23:30', lock: false, trust: true })

/** GET /presets as the wizard tests see it. */
export const catalog: PresetCatalog = {
  style: null,
  kids: [],
  plans: {
    little: { relaxed: plan(), balanced: plan(), strict: plan() },
    kid: { relaxed: plan(), balanced: plan(), strict: plan() },
    teen: { relaxed: relaxedTeen, balanced: plan(), strict: plan() },
  },
  family: { relaxed: { banked: true }, balanced: { banked: true }, strict: { banked: false } },
}

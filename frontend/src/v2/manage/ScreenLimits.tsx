/** "No max", then 15…240 in 15s (plus `keep` when it is off that list). */
export function MaxOptions({ keep }: { keep?: number | null }) {
  const steps = Array.from({ length: 16 }, (_, i) => (i + 1) * 15)
  if (keep && !steps.includes(keep)) steps.push(keep)
  return (
    <>
      <option value="">No max</option>
      {steps.map((n) => (
        <option key={n} value={n}>
          {n} min
        </option>
      ))}
    </>
  )
}

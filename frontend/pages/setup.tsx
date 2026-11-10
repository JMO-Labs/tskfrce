import { useEffect, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useUnifiedAuth } from '@/contexts/UnifiedAuthContext'
import { api, ApiError } from '@/v2/api'
import type { Device, Family, HoursPayload, Kid, LibChore, RuleBody, SetupStatus } from '@/v2/types'
import type { PresetCatalog, Style } from '@/v2/presets/types'
import { useApplyPreset } from '@/v2/presets/usePresets'
import { markSetupDone, STEP_KEY } from '@/v2/components/RequireParent'
import { SetupResuming } from '@/v2/parent/states'
import { LAST, saveStep } from '@/v2/setup/setupStep'
import { useSingleFlight } from '@/v2/hooks/useSingleFlight'
import { useLook } from '@/v2/parent/useLook'
import { WizardFrame } from '@/v2/setup/WizardFrame'
import { useOnChange } from '@/v2/hooks/useOnChange'
import { useClientValue } from '@/v2/hooks/useClientValue'
import { StepFamily, detectTz } from '@/v2/setup/StepFamily'
import { StepParent, parentErrors, type ParentForm } from '@/v2/setup/StepParent'
import { StepPhones } from '@/v2/setup/StepPhones'
import { StepKids } from '@/v2/setup/StepKids'
import { StepDevices } from '@/v2/setup/StepDevices'
import { StepChores } from '@/v2/setup/StepChores'
import { starter } from '@/v2/setup/starterChores'
import { StepExtras } from '@/v2/setup/StepExtras'
import { StepHours } from '@/v2/setup/StepHours'
import { StepStyle } from '@/v2/setup/StepStyle'
import { StepPlan } from '@/v2/setup/StepPlan'
import { applyBody, choreJobs, DEFAULT_DRAFTS, extrasJobs, hoursJobs, newChoreCache, presetKids, tweakStart, type Job } from '@/v2/setup/setupJobs'
import { ClaimGate } from '@/v2/setup/ClaimGate'
import { clearClaim, settleClaim } from '@/v2/setup/claim'
import { finishSummary, StepFinish } from '@/v2/setup/StepFinish'

export default function SetupPage() {
  useLook('parent')
  const router = useRouter()
  const qc = useQueryClient()
  const { loginWithToken, isInitialized, isAuthenticated } = useUnifiedAuth()
  const [step, setStep] = useState(1)
  const [claim, setClaim] = useState<string | null>(null)
  const [tried, setTried] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [accountDone, setAccountDone] = useState(false)
  const [loginFailed, setLoginFailed] = useState(false)
  const [kidDraft, setKidDraft] = useState('')
  const [justCreated, setJustCreated] = useState(false)
  const once = useSingleFlight()
  const [familyEdit, setFamily] = useState<{ name: string; tz: string | null }>({ name: '', tz: null })
  const detectedTz = useClientValue(detectTz, 'UTC') // server renders UTC
  const family = { name: familyEdit.name, tz: familyEdit.tz ?? detectedTz }
  const [parent, setParent] = useState<ParentForm>({ username: '', password: '', again: '', fullName: '' })
  const [kids, setKids] = useState<Kid[]>([])
  const [chores, setChores] = useState<string[]>([])
  const [addedStarters, setAdded] = useState<string[]>([]) // starters a resumed wizard already created: shown as Added, not editable
  const [hours, setHours] = useState<RuleBody[]>(DEFAULT_DRAFTS)
  const [trustKids, setTrustKids] = useState<number[]>([])
  const [bedtimeAuto, setBedtimeAuto] = useState(false)
  const [choresLock, setChoresLock] = useState(true)
  const [style, setStyle] = useState<Style>('balanced')
  const [kidStyles, setKidStyles] = useState<Record<number, Style> | null>(null) // set = "Different for each kid"
  const [tweak, setTweak] = useState<'chores' | 'hours' | 'extras' | null>(null) // sub-steps of step 5
  const [assign, setAssign] = useState<Record<string, number[]>>({}) // chore title -> the kids whose plan has it
  const applyPreset = useApplyPreset()
  const applied = useRef(new Set<string>())
  const [schedules, setSchedules] = useState(0) // applied schedule rules, mirrored for render
  const choreCache = useRef(newChoreCache()) // created chores, so a retry only redoes the assignment

  // Already set up (and not by us a moment ago): a parent who never reached Finish resumes; anyone else logs in.
  const status = useQuery({ queryKey: ['setup'], queryFn: () => api<SetupStatus>('/setup'), staleTime: Infinity })
  useEffect(() => settleClaim(status.data), [status.data])
  const returning = status.data?.needed === false && !justCreated
  const resume = useQuery({
    queryKey: STEP_KEY,
    queryFn: () => api<{ step: number | null }>('/setup/step'),
    enabled: returning && !!isInitialized && !!isAuthenticated,
    staleTime: 0,
    retry: false,
  })
  const resumeAt = typeof resume.data?.step === 'number' ? resume.data.step : null
  useEffect(() => {
    if (!returning || isInitialized === false || (isAuthenticated && resume.isPending)) return
    if (resumeAt === null && !accountDone) router.replace('/login') // Finish clears the saved step: stay for "all set"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data, isInitialized, isAuthenticated, resume.isPending, resumeAt])
  const [resumed, setResumed] = useState(false) // this wizard picked up a saved step (not one we just created)
  useOnChange(resumeAt, (at) => {
    if (at === null || accountDone) return
    setAccountDone(true)
    setStep(at)
    setResumed(true)
    // ponytail: belt for cached state past the last step; GET /setup/step already reads those as finished
    if (at > LAST) saveStep(qc, at) // a save past the last step: finish it so the guard stops sending us back
  })
  useEffect(() => {
    if (!resumed) return
    api<Kid[]>('/kids').then(setKids).catch(() => {}) // the wizard forgot them; steps 4-6 need them
    api<LibChore[]>('/chores/') // ...and the starters it already made
      .then((have) => Array.isArray(have) && setAdded(have.map((h) => h.title).filter((t) => starter(t))))
      .catch(() => {})
  }, [resumed])

  const create = useMutation({
    mutationFn: async () => {
      const r = await api<{ access_token: string; refresh_token: string; expires_in: number }>('/setup', {
        method: 'POST',
        body: {
          ...(claim ? { claim_code: claim } : {}),
          family_name: family.name.trim(),
          timezone: family.tz,
          parent: { username: parent.username, password: parent.password, full_name: parent.fullName.trim() },
        },
      })
      // The account exists from here on. Never POST /setup again, even if logging in fails.
      setJustCreated(true)
      setAccountDone(true)
      markSetupDone(qc)
      clearClaim()
      try {
        await loginWithToken(r.access_token, r.refresh_token, r.expires_in)
        return true
      } catch {
        return false
      }
    },
    onSuccess: (loggedIn) => {
      setTried(false)
      if (loggedIn) setStep(3)
      else setLoginFailed(true)
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(true)
      if (e instanceof ApiError && e.status === 403) {
        setClaim(null)
        clearClaim()
      }
    },
  })

  /** POST each not-yet-applied request; remember successes so Back/Next never duplicates. */
  const apply = useMutation({
    mutationFn: async (jobs: Job[]) => {
      for (const j of jobs) {
        if (applied.current.has(j.key)) continue
        await j.run()
        applied.current.add(j.key)
        setSchedules(Array.from(applied.current).filter((k) => k.startsWith('rule:')).length)
      }
    },
    onSuccess: () => go(step + 1),
  })

  const go = (n: number) => {
    setTried(false)
    create.reset()
    apply.reset()
    setTweak(null)
    setStep(n)
    if (justCreated || accountDone) saveStep(qc, n)
  }

  // one request per click even on a double-click; failures show via apply.error
  // one request per click even on a double-click; failures show via apply.error
  const run = (jobs: Job[]) =>
    void once(() => apply.mutateAsync(jobs).catch(() => {}))

  const sub = (t: typeof tweak) => {
    apply.reset()
    setTweak(t)
  }
  const presetJob = (skip?: string[]): Job => {
    const body = applyBody(style, kids, kidStyles, skip)
    return { key: `${skip ? 'preset:tweak' : 'preset'}:${JSON.stringify(body)}`, run: () => applyPreset.mutateAsync(body) }
  }
  const startTweak = (catalog: PresetCatalog) => {
    const t = tweakStart(presetKids(kids, kidStyles, style), catalog, style)
    setChores(t.chores.filter((c) => !addedStarters.includes(c)))
    setAssign(t.assign)
    if (t.hours.length) setHours(t.hours)
    setChoresLock(t.lock)
    setTrustKids(t.trust)
    sub('chores')
  }
  /** Looks good applies the plan; Tweak walks Chores, Hours, Extras, then applies it with those three skipped. */
  const nextPlan = () => {
    if (tweak === 'chores') return sub('hours')
    if (tweak === 'hours') return sub('extras')
    if (tweak === null) return run([presetJob()])
    run([
      ...(kids.length === 0 ? [] : choreJobs(chores, (t) => assign[t] ?? kids.map((k) => k.id), choreCache.current)),
      ...hoursJobs(hours, choresLock),
      ...extrasJobs(trustKids, bedtimeAuto),
      presetJob(['chores', 'bedtime', 'trust']),
    ])
  }
  const back = () => (tweak === 'extras' ? sub('hours') : tweak === 'hours' ? sub('chores') : tweak === 'chores' ? sub(null) : go(step - 1))

  const next = () => {
    if (step === 1) {
      const e = parentErrors(parent)
      if (e.fullName || e.username || e.password || e.again) return setTried(true)
      return go(2)
    }
    // The family name goes in the same POST /setup that makes the account.
    if (step === 2) {
      if (loginFailed) return
      if (!family.name.trim()) return setTried(true)
      if (accountDone) return go(3)
      setConflict(false)
      return void once(() => create.mutateAsync().catch(() => {})) // errors show via create.error
    }
    if (step === 5) return nextPlan()
    if (step > LAST) return
    if (step === 3 && kidDraft.trim()) return setTried(true)
    go(step + 1)
  }

  const err = (create.error && !conflict ? create.error.message : null) ?? apply.error?.message

  const stepTitles = {
    1: { title: 'Make your parent account', sub: "You'll use this to log in. You can invite another parent later." },
    2: { title: 'Your family', sub: 'Shown on the kids\' screens and in notifications.' },
    3: { title: 'Who are your kids?', sub: 'Add each kid, one at a time. You can add more later.' },
    4: { title: 'How strict should it be?', sub: 'You can change anything later.' },
    5: { title: "Here's your plan", sub: "Set for each kid's age and style." },
    6: { title: "Kids' phones", sub: "Each kid scans their code with their phone's camera. No phone? Skip it. You can do this later from the kid's page." },
    7: { title: 'Whose devices are these?', sub: 'Give each one an owner, or mark it Guest so it\'s never blocked.' },
  } as const
  const tweakTitles = {
    chores: { title: 'Pick some starter chores', sub: 'Tap to choose. Everything can be changed later.' },
    hours: { title: 'When can devices be online?', sub: 'Devices are on during these hours and off at bedtime. Add school hours, holidays and per-kid hours later in Settings.' },
    extras: { title: 'Optional extras', sub: 'Two ways to do less tapping. All off unless you switch them on.' },
  } as const
  const head = tweak ? tweakTitles[tweak] : stepTitles[step as keyof typeof stepTitles]

  // what really exists (a resumed wizard forgot what it made)
  const made = useQuery({
    queryKey: ['setup-made'],
    queryFn: async () => ({ chores: (await api<unknown[]>('/chores/')).length, rules: (await api<HoursPayload>('/hours')).rules.length }),
    enabled: step > LAST,
    retry: false,
  })
  const fam = useQuery({ queryKey: ['setup-family'], queryFn: () => api<Family>('/family'), enabled: step > LAST, retry: false })
  const devices = (qc.getQueryData<Device[]>(['setup-devices']) ?? []).filter((d) => d.status !== 'unassigned').length

  if (status.data?.claim && !claim && !accountDone) return <ClaimGate onClaimed={setClaim} />

  if (returning && !accountDone)
    return (
      <main className="p-guard-state">{resumeAt !== null && <SetupResuming step={resumeAt} />}</main>
    )

  return (
    <>
      <Head><title>Set up t@sk4ce</title></Head>
      <div className="f-shell" style={{ minHeight: '100vh' }}>
        <WizardFrame
          step={step}
          title={step > LAST ? 'You\'re all set' : head.title}
          subtitle={step > LAST ? finishSummary(kids.length, made.data?.chores ?? chores.length, devices, made.data?.rules ?? schedules) : head.sub}
          onBack={step > 2 || (step === 2 && !accountDone) ? back : undefined}
          onNext={next}
          nextLabel={step === LAST ? 'Finish' : 'Next'}
          hideNext={step === 5 && !tweak}
          onSkip={step >= 3 && step <= LAST && step !== 4 && step !== 5 && !tweak && !(step === 6 && kids.length === 0) ? () => go(step + 1) : undefined}
          onStepClick={(n) => {
            if (n > step && n > step + 1) return // Can't skip ahead multiple steps
            go(n)
          }}
          busy={create.isPending || apply.isPending}
          done={step > LAST}
          note={step === 5 && tweak === 'chores' ? `${chores.length} picked` : undefined}
        >
          {step === 1 && <StepParent value={parent} showError={tried} onChange={setParent} />}
          {step === 2 && (
            <StepFamily name={family.name} tz={family.tz} showError={tried}
              onName={(name) => setFamily({ ...family, name })} onTz={(tz) => setFamily({ ...family, tz })} />
          )}
          {step === 2 && conflict && (
            <p role="alert">Setup is already done. <Link href="/login">Log in</Link> instead.</p>
          )}
          {step === 2 && loginFailed && (
            <p role="alert">Your account was created. <Link href="/login">Log in</Link> to continue.</p>
          )}
          {step === 3 && <StepKids kids={kids} name={kidDraft} onName={setKidDraft} onAdd={(k) => setKids([...kids, k])}
              draftError={tried && kidDraft.trim() ? `Add ${kidDraft.trim()} first or clear the field.` : undefined} />}
          {step === 4 && <StepStyle kids={kids} style={style} onStyle={setStyle} styles={kidStyles} onStyles={setKidStyles} />}
          {step === 5 && !tweak && <StepPlan kids={presetKids(kids, kidStyles, style)} style={style} onTweak={startTweak} busy={apply.isPending} />}
          {step === 5 && tweak === 'chores' && <StepChores selected={chores} made={addedStarters} hasKids={kids.length > 0} onChange={setChores} />}
          {step === 5 && tweak === 'hours' && <StepHours drafts={hours} onChange={setHours} choresLock={choresLock} onChoresLock={setChoresLock} />}
          {step === 5 && tweak === 'extras' && <StepExtras kids={kids} trust={trustKids} bedtime={bedtimeAuto} onTrust={setTrustKids} onBedtime={setBedtimeAuto} />}
          {step === 6 && <StepPhones kids={kids} />}
          {step === 7 && <StepDevices kids={kids} />}
          {step > LAST && (
            <StepFinish resetTime={fam.data?.reset_time} chores={made.data?.chores ?? chores.length} kids={kids.length} lock={fam.data?.chores_lock ?? choresLock} />
          )}
          {err && <p role="alert">Something went wrong: {err} Try again.</p>}
        </WizardFrame>
      </div>
    </>
  )
}

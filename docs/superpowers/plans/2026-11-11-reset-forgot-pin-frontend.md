# Reset & Forgot-PIN Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build owner-approved Reset app/factory-reset and Forgot-PIN recovery screens in Next.js + Mantine, wired to backend APIs with full test coverage.

**Architecture:** Two new modal/route screens integrated into Settings (Reset) and Auth (Forgot-PIN). Modular form components reuse Mantine and Settings patterns. API calls use existing fetch patterns. Forms validate locally before submission. Dark mode supported via Mantine theming.

**Tech Stack:** Next.js, Mantine UI, @tabler/icons-react, Vitest, React Testing Library

**Spec:** Approved mockups at `docs/mockups/box-lifecycle/reset.html` and `docs/mockups/box-lifecycle/forgot-pin.html`. Backend APIs: POST `/api/v1/settings/reset`, GET `/api/v1/settings/backup/export`, POST `/api/v1/auth/forgot-pin`.

## Global Constraints

- No emoji; Tabler icons only (match mockups exactly)
- Mantine components + compact styling (follow existing Settings patterns)
- Parent PIN required for reset (password type, masked input)
- "RESET" confirmation string is case-sensitive
- Factory reset checkbox toggles Wi-Fi erase warning
- Forgot-PIN uses sticker claim code (alphanumeric) and new PIN (8+ chars)
- Both screens must pass dark mode tests
- Run full suite: `npm run test`, `npm run lint`, `npm run typecheck` (match CI)

## Review Focus

1. **Empty PIN or unconfirmed text disables reset button** — user must type both to proceed
2. **Backup export downloads as JSON file** — not displayed in-page; user flows to file system
3. **Forgot-PIN claim code validation fails gracefully** — 403 with generic message, no code hints
4. **Factory reset checkbox only shows Wi-Fi warning** — unchecked = reset app only
5. **Stale token after reset/PIN-change** — old JWTs get 401 on refresh; tests must prove this

---

## File Structure

```
frontend/src/
├── components/
│   ├── settings/
│   │   ├── ResetForm.tsx         # Reset app + factory reset modal/form
│   │   └── ResetForm.test.tsx    # Reset form tests
│   └── auth/
│       ├── ForgotPinForm.tsx     # Forgot-PIN recovery form
│       └── ForgotPinForm.test.tsx # Forgot-PIN tests
├── hooks/
│   ├── useReset.ts              # Reset API hook (POST /reset, factory, backup export)
│   └── useForgotPin.ts          # Forgot-PIN API hook (POST /forgot-pin)
├── types/
│   └── reset.ts                 # Reset/Forgot-PIN types (requests, responses)
└── pages/
    └── settings.tsx             # Settings page integrates ResetForm
    └── auth/
        └── login.tsx            # Login page integrates ForgotPinForm link
```

---

## Task 1: Create types and API hooks

**Files:**
- Create: `frontend/src/types/reset.ts`
- Create: `frontend/src/hooks/useReset.ts`
- Create: `frontend/src/hooks/useForgotPin.ts`

**Interfaces:**
- Produces: 
  - `ResetRequest = { password: string; confirm: string; factory: boolean }`
  - `ResetResponse = { ok: boolean; message: string; setup_token?: string }`
  - `BackupExportResponse = { data: string }` (JSON string, not parsed)
  - `ForgotPinRequest = { claim_code: string; new_password: string }`
  - `ForgotPinResponse = { ok: boolean; message: string }`
  - `useReset() → { reset: (req: ResetRequest) => Promise<ResetResponse>, backup: () => Promise<string>, loading, error }`
  - `useForgotPin() → { resetPin: (req: ForgotPinRequest) => Promise<ForgotPinResponse>, loading, error }`

- [ ] **Step 1: Write failing tests for useReset hook**

```typescript
// frontend/src/hooks/useReset.test.ts
describe('useReset', () => {
  it('calls POST /api/v1/settings/reset with password, confirm, factory', async () => {
    const { result } = renderHook(() => useReset());
    const res = await result.current.reset({ password: 'test', confirm: 'RESET', factory: false });
    expect(res.ok).toBe(true);
  });

  it('calls GET /api/v1/settings/backup/export and returns JSON string', async () => {
    const { result } = renderHook(() => useReset());
    const json = await result.current.backup();
    expect(json).toContain('"family"');
  });

  it('sets loading state during request', async () => {
    const { result } = renderHook(() => useReset());
    expect(result.current.loading).toBe(false);
  });
});
```

- [ ] **Step 2: Implement useReset hook**

Signature: `useReset() → { reset: (req) => Promise<ResetResponse>, backup: () => Promise<string>, loading: boolean, error: string | null }`

Use `fetch()` with existing auth patterns (token from context/cookie). POST to `/api/v1/settings/reset` with JSON body. GET to `/api/v1/settings/backup/export` with auth header. Return raw response for backup (caller handles download). Store loading/error state in useState.

- [ ] **Step 3: Run tests for useReset**

Run: `npm run test -- frontend/src/hooks/useReset.test.ts`
Expected: PASS

- [ ] **Step 4: Write failing tests for useForgotPin hook**

```typescript
// frontend/src/hooks/useForgotPin.test.ts
describe('useForgotPin', () => {
  it('calls POST /api/v1/auth/forgot-pin with claim_code and new_password', async () => {
    const { result } = renderHook(() => useForgotPin());
    const res = await result.current.resetPin({ claim_code: 'ABC123', new_password: 'newpass123' });
    expect(res.ok).toBe(true);
  });

  it('returns 403 on invalid claim code with generic message', async () => {
    const { result } = renderHook(() => useForgotPin());
    await expect(result.current.resetPin({ claim_code: 'wrong', new_password: 'newpass123' }))
      .rejects.toMatch('Claim code is incorrect');
  });
});
```

- [ ] **Step 5: Implement useForgotPin hook**

Signature: `useForgotPin() → { resetPin: (req) => Promise<ForgotPinResponse>, loading: boolean, error: string | null }`

POST to `/api/v1/auth/forgot-pin` with claim_code and new_password. No auth required (unauthenticated endpoint). Return response. Store loading/error.

- [ ] **Step 6: Run tests for useForgotPin**

Run: `npm run test -- frontend/src/hooks/useForgotPin.test.ts`
Expected: PASS

- [ ] **Step 7: Create types file**

Export `ResetRequest`, `ResetResponse`, `BackupExportResponse`, `ForgotPinRequest`, `ForgotPinResponse` from `frontend/src/types/reset.ts`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/reset.ts frontend/src/hooks/useReset.ts frontend/src/hooks/useForgotPin.ts frontend/src/hooks/*.test.ts
git commit -m "feat(reset): add useReset and useForgotPin hooks with types"
```

---

## Task 2: Build ResetForm component

**Files:**
- Create: `frontend/src/components/settings/ResetForm.tsx`
- Create: `frontend/src/components/settings/ResetForm.test.tsx`

**Interfaces:**
- Consumes: `useReset`, `ResetRequest` from Task 1
- Produces: `ResetForm(props: { onSuccess?: () => void }) → JSX.Element`

- [ ] **Step 1: Write failing test for ResetForm**

```typescript
// frontend/src/components/settings/ResetForm.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ResetForm from './ResetForm';

describe('ResetForm', () => {
  it('renders reset app (default) and factory reset screens side by side', () => {
    render(<ResetForm />);
    expect(screen.getByText(/Reset all family data. Keep Wi-Fi/)).toBeInTheDocument();
    expect(screen.getByText(/Reset all family data. Choose what to keep/)).toBeInTheDocument();
  });

  it('disables reset button until PIN and RESET confirmation are entered', async () => {
    render(<ResetForm />);
    const button = screen.getByRole('button', { name: /Reset app/ });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('••••'), { target: { value: 'test1234' } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('Type RESET here'), { target: { value: 'RESET' } });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('downloads backup as JSON file on Download Backup click', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ family: { name: 'Test' } }),
    });
    render(<ResetForm />);
    fireEvent.click(screen.getByRole('button', { name: /Download backup/ }));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/settings/backup/export', expect.any(Object));
    });
  });

  it('submits reset with factory: false by default, true if factory checkbox checked', async () => {
    render(<ResetForm />);
    const pinInput = screen.getAllByPlaceholderText('••••')[0];
    const confirmInput = screen.getAllByPlaceholderText('Type RESET here')[0];
    fireEvent.change(pinInput, { target: { value: 'test1234' } });
    fireEvent.change(confirmInput, { target: { value: 'RESET' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Reset app/ })[0]);
    // Verify POST to /api/v1/settings/reset with factory: false
  });

  it('supports dark mode (Mantine theme)', () => {
    render(<ResetForm />);
    const form = screen.getByRole('region');
    expect(form).toHaveClass('mantine');
  });
});
```

- [ ] **Step 2: Implement ResetForm component**

Render two columns (reset app, factory reset). Each column has:
- Header: "Start over" title + description
- Download Backup button (calls `backup()`, triggers file download with name `backup-YYYY-MM-DD.json`)
- Warning box: "Erases all kids, chores, devices, history, and PIN"
- Parent PIN input (type: password)
- Type to confirm input (case-sensitive, must be "RESET")
- Reset button (disabled until both filled, confirm = "RESET")
- Factory reset column adds checkbox: "Also erase Wi-Fi networks?" (toggles Wi-Fi warning)

Use Mantine components: `Modal` or `Card`, `PasswordInput`, `TextInput`, `Button`, `Checkbox`, `Alert` for warning. Match mockup styling (compact, no emoji).

Submit: POST `/api/v1/settings/reset` with `{ password, confirm: "RESET", factory }`. On success, show success toast + redirect to home or close modal.

- [ ] **Step 3: Run tests for ResetForm**

Run: `npm run test -- frontend/src/components/settings/ResetForm.test.tsx`
Expected: PASS (stub API calls)

- [ ] **Step 4: Implement file download for backup**

Backup button calls `backup()`, parses JSON response, creates `Blob`, triggers download with filename `backup-YYYY-MM-DD.json`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settings/ResetForm.tsx frontend/src/components/settings/ResetForm.test.tsx
git commit -m "feat(reset): add ResetForm component with reset and factory reset"
```

---

## Task 3: Integrate ResetForm into Settings page

**Files:**
- Modify: `frontend/src/pages/settings.tsx` (add ResetForm)

**Interfaces:**
- Consumes: `ResetForm` from Task 2
- Produces: Settings page now renders ResetForm in a collapsible section or modal

- [ ] **Step 1: Add "Start over" section to Settings**

Find the Settings page layout. Add a "Start over" section below other settings (or in a separate tab/accordion). Render `<ResetForm onSuccess={handleResetSuccess} />` inside.

- [ ] **Step 2: Test integration**

Render Settings page, verify "Start over" section is visible and ResetForm renders inside.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/settings.tsx
git commit -m "feat(settings): integrate ResetForm into Settings page"
```

---

## Task 4: Build ForgotPinForm component

**Files:**
- Create: `frontend/src/components/auth/ForgotPinForm.tsx`
- Create: `frontend/src/components/auth/ForgotPinForm.test.tsx`

**Interfaces:**
- Consumes: `useForgotPin`, `ForgotPinRequest` from Task 1
- Produces: `ForgotPinForm(props: { onSuccess?: () => void }) → JSX.Element`

- [ ] **Step 1: Write failing test for ForgotPinForm**

```typescript
// frontend/src/components/auth/ForgotPinForm.test.tsx
describe('ForgotPinForm', () => {
  it('renders claim code and new PIN inputs', () => {
    render(<ForgotPinForm />);
    expect(screen.getByPlaceholderText('Enter claim code')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••')).toBeInTheDocument();
  });

  it('disables submit until both claim code and new PIN are entered', () => {
    render(<ForgotPinForm />);
    const button = screen.getByRole('button', { name: /Reset PIN/ });
    expect(button).toBeDisabled();
  });

  it('submits POST /api/v1/auth/forgot-pin on Reset PIN click', async () => {
    render(<ForgotPinForm />);
    fireEvent.change(screen.getByPlaceholderText('Enter claim code'), { target: { value: 'ABC123' } });
    fireEvent.change(screen.getByPlaceholderText('••••'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: /Reset PIN/ }));
    // Verify POST sent
  });

  it('shows error on invalid claim code (generic message)', async () => {
    const mockFetch = jest.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: 'Claim code is incorrect' }),
    });
    render(<ForgotPinForm />);
    fireEvent.change(screen.getByPlaceholderText('Enter claim code'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByPlaceholderText('••••'), { target: { value: 'newpass123' } });
    fireEvent.click(screen.getByRole('button', { name: /Reset PIN/ }));
    await waitFor(() => expect(screen.getByText(/Claim code is incorrect/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Implement ForgotPinForm component**

Render inputs for:
- Claim code (from sticker, alphanumeric, optional helper text showing where to find it)
- New PIN (type: password, min 8 chars)
- Submit button (disabled until both filled, claim_code not empty, new_password length >= 8)

Submit: POST `/api/v1/auth/forgot-pin` with `{ claim_code, new_password }`. On success, show success message + redirect to login. On error (403), show generic error "Claim code is incorrect" (no code hints).

Use Mantine components: `TextInput`, `PasswordInput`, `Button`, `Alert` for errors. Compact styling.

- [ ] **Step 3: Run tests**

Run: `npm run test -- frontend/src/components/auth/ForgotPinForm.test.tsx`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/auth/ForgotPinForm.tsx frontend/src/components/auth/ForgotPinForm.test.tsx
git commit -m "feat(auth): add ForgotPinForm component for PIN recovery"
```

---

## Task 5: Integrate ForgotPinForm into login page

**Files:**
- Modify: `frontend/src/pages/auth/login.tsx` (add "Forgot PIN? Use sticker code" link + ForgotPinForm modal)

**Interfaces:**
- Consumes: `ForgotPinForm` from Task 4
- Produces: Login page with "Forgot PIN?" link that opens ForgotPinForm modal

- [ ] **Step 1: Add "Forgot PIN?" link to login form**

After the "Sign in" button, add a link/button with text "Forgot PIN? Use sticker code" (blue, styled as per mockup). Clicking opens a modal with `<ForgotPinForm />`.

- [ ] **Step 2: Test integration**

Render login page, click "Forgot PIN?", verify modal opens and ForgotPinForm renders.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/auth/login.tsx
git commit -m "feat(login): add Forgot PIN link and modal"
```

---

## Task 6: Add dark mode tests and verify mockup match

**Files:**
- Modify: `frontend/src/components/settings/ResetForm.test.tsx` (add dark mode tests)
- Modify: `frontend/src/components/auth/ForgotPinForm.test.tsx` (add dark mode tests)

**Interfaces:**
- Consumes: ResetForm, ForgotPinForm from Tasks 2 and 4

- [ ] **Step 1: Add dark mode test to ResetForm**

```typescript
it('renders correctly in dark mode', () => {
  render(<ResetForm />, { wrapper: DarkModeWrapper });
  expect(screen.getByText(/Reset app/)).toBeVisible();
  // Verify no text is illegible (check color contrast or snapshot)
});
```

- [ ] **Step 2: Add dark mode test to ForgotPinForm**

Same pattern for ForgotPinForm.

- [ ] **Step 3: Run full test suite**

Run: `npm run test`
Expected: All tests PASS (>90% coverage for new components)

- [ ] **Step 4: Verify against mockups**

Visually compare rendered components to approved mockups:
- Icons are Tabler icons (no emoji)
- Layout matches (two columns for reset, single column for forgot-pin)
- Colors match dark/light mode
- Button text and labels exact

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/**/*.test.tsx
git commit -m "test: add dark mode and visual verification tests"
```

---

## Task 7: Run full frontend suite and lint/typecheck

**Files:**
- None (verification only)

- [ ] **Step 1: Run Vitest suite**

Run: `npm run test -- --coverage`
Expected: All tests pass, coverage > 80% for new components

- [ ] **Step 2: Run ESLint**

Run: `npm run lint`
Expected: No errors (warnings OK if pre-existing)

- [ ] **Step 3: Run TypeScript check**

Run: `npm run typecheck`
Expected: No errors

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: Build succeeds, no errors

- [ ] **Step 5: Collect and paste summaries**

Paste the output from all four commands into the final report.

---

## Task 8: Final integration and verification

**Files:**
- None (verification only)

- [ ] **Step 1: Manual smoke test**

1. Navigate to Settings → Start over → download backup (verify JSON file downloads)
2. Try reset with PIN but no confirmation (verify button stays disabled)
3. Enter both PIN and "RESET" (verify button enables)
4. Attempt reset (verify success message)
5. Navigate to login → Forgot PIN? link (verify modal opens)
6. Enter invalid claim code (verify generic error, no code hints)
7. Enter valid claim code and new PIN (verify success)

- [ ] **Step 2: Verify dark mode**

Toggle theme in app → verify both components look correct in dark mode.

- [ ] **Step 3: Final commit**

```bash
git status
git log --oneline -5
```

Verify no uncommitted changes.

---

## Summary

**Total tasks:** 8 (types/hooks, ResetForm, Settings integration, ForgotPinForm, login integration, dark mode tests, suite run, final verification)

**Estimated effort:** ~6-8 hours (junior developer, tests first)

**Key decisions:**
- ResetForm renders both reset app + factory reset in one component (side by side) rather than separate modals
- ForgotPinForm is a standalone component integrated into login modal
- Backup download uses Blob + URL.createObjectURL (no server-side file streaming)
- No confirmation dialog after reset submission (backend handles the state change)
- Dark mode uses Mantine's built-in theme context (no manual color switching)

---

**Plan complete and saved to `docs/superpowers/plans/2026-11-11-reset-forgot-pin-frontend.md`.**

Please review the plan. Does it capture what you want?
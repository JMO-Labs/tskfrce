import { beforeEach, describe, expect, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { api } from "@/v2/api";
import { WasntDoneSheet } from "@/v2/today/WasntDoneSheet";
import { WaitingActions } from "@/v2/today/WaitingActions";
import { InboxPenaltyRow as InboxRow } from "@/v2/components/InboxPenaltyRow";
import { KidFocus } from "@/v2/today/KidFocus";
import { ChoreOpen } from "@/v2/today/ChoreOpen";
import { SelfApprovedList } from "@/v2/manage/SelfApprovedList";
import { TodayPage } from "@/v2/today/TodayPage";

jest.mock("@/v2/api", () => ({ api: jest.fn(), kidToken: () => null }));
jest.mock("next/router", () => ({ useRouter: () => ({ asPath: "/", query: {}, push: jest.fn(), replace: jest.fn(), events: { on: jest.fn(), off: jest.fn() } }) }));
jest.mock("@/contexts/UnifiedAuthContext", () => ({ useUnifiedAuth: () => ({ logout: jest.fn(), user: { id: 1 } }) }));
jest.mock("@/v2/chat/ChatDock", () => ({ ChatDock: () => null }));
jest.mock("@/v2/components/BlockerBanner", () => ({ BlockerBanner: () => null }));
jest.mock("@/v2/components/Bell", () => ({ Bell: () => null }));
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));
jest.mock("@/v2/chat/dock", () => ({ ...jest.requireActual("@/v2/chat/dock"), openChat: jest.fn(), openChatAfterNav: jest.fn() }));
const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>;

let enabled = true;
beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (p: string) => {
    if (p === "/family") return { penalties_enabled: enabled };
    if (p === "/devices") return [{ id: 7, owner_ids: [3] }];
    if (p.startsWith("/penalties/options"))
      return { enabled: true, sizes: { small: { kind: "block", amount: 60, earn_back: "all" }, medium: { kind: "block", amount: 1440, earn_back: "half" }, big: { kind: "block", amount: 4320, earn_back: "none" } }, makeup_chores: [], kids: [{ id: 3, name: "Ivy", recent: 0, devices: [], groups: [] }, { id: 4, name: "Sam", recent: 0, devices: [], groups: [] }] };
    if (p === "/happy-hour") return { active: [], recent: [] };
    if (p === "/hours") return { rules: [] };
    if (p === "/me/tips") return { dismissed: ["onboard.parent"] };
    if (p === "/today") return { day: "2026-11-10", pending_approvals: 0, new_devices: [], needs_you: [], kids: [{ id: 3, name: "Ivy", chores: [], devices: [] }, { id: 4, name: "Sam", chores: [], devices: [] }] };
    if (p === "/chores/11") return { id: 11, title: "Tidy", points: 5, state: "needs_you", kid_ids: [3], photos: [], steps: [], type: { id: 1, name: "C", glyph: "x" }, note: null, can_move: false };
    if (p === "/kids/3/self-approved") return [{ id: 9, title: "Dishes", day: "2026-11-10", points: 5, approved_at: new Date().toISOString(), approved_via: "bedtime" }];
    if (p.startsWith("/chat/threads")) return { id: 5, kind: "chore", title: "Tidy", messages: [], has_more: false, total: 0, threads: [] };
    return [];
  });
});
const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );

const wasnt = (
  <WasntDoneSheet run={{ id: 9, title: "Dishes", day: "2026-11-10", points: 5 }} today="2026-11-10" kidName="Ivy" kidId={3} onClose={() => {}} />
);
const waiting = (
  <WaitingActions item={{ type: "chore", id: 9, kid_id: 3, kid_name: "Ivy", title: "Dishes" } as never} name="Dishes" act={{} as never} />
);
const row = (kind: string, extra = {}) => (
  <InboxRow
    n={{ id: 1, kind, title: "Alert", body: "", read: false, pending: false, kid_id: 3, kid_name: "Ivy", device_id: 7, run_id: null, created_at: new Date().toISOString(), ...extra } as never}
    live busy={false} sending={false} note="" onNote={() => {}} onApprove={() => {}} onSendBack={() => {}}
    onDecide={() => {}} onDismiss={() => {}} onLock={() => {}} onOpen={() => {}} go={async () => {}}
  />
);

describe("penalty entry points", () => {
  test("WasntDoneSheet: tick expands the sheet; hidden when off", async () => {
    enabled = true;
    const { unmount } = wrap(wasnt);
    await userEvent.click(await screen.findByLabelText("Give penalty"));
    expect(await screen.findByRole("button", { name: "Small" })).toBeTruthy();
    unmount();
    enabled = false;
    wrap(wasnt);
    await screen.findByText(/goes back on/);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/family"));
    expect(screen.queryByLabelText("Give penalty")).toBeNull();
  });

  test("WaitingActions: menu item follows the flag", async () => {
    enabled = true;
    const { unmount } = wrap(waiting);
    await userEvent.click(screen.getByRole("button", { name: "More for Dishes" }));
    expect(await screen.findByRole("menuitem", { name: /Give penalty/ })).toBeTruthy();
    unmount();
    enabled = false;
    wrap(waiting);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/family"));
    await userEvent.click(screen.getByRole("button", { name: "More for Dishes" }));
    expect(screen.queryByRole("menuitem", { name: /Give penalty/ })).toBeNull();
  });

  test("InboxRow: only bypass alerts with a kid; owner fallback; off hides", async () => {
    enabled = true;
    const { unmount } = wrap(row("device_bypass"));
    await userEvent.click(screen.getByRole("button", { name: "More for Alert" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Give penalty/ }));
    expect(await screen.findByRole("button", { name: "Medium" })).toBeTruthy();
    unmount();
    const r2 = wrap(row("device_bypass", { kid_id: null }));
    await userEvent.click(screen.getByRole("button", { name: "More for Alert" }));
    expect(await screen.findByRole("menuitem", { name: /Give penalty/ })).toBeTruthy();
    r2.unmount();
    wrap(row("chore_submitted"));
    await userEvent.click(screen.getByRole("button", { name: "More for Alert" }));
    expect(screen.queryByRole("menuitem", { name: /Give penalty/ })).toBeNull();
  });
});

const posts = () => apiMock.mock.calls.filter(([p, i]) => p === "/penalties" && i?.method === "POST").map(([, i]) => i?.body as Record<string, unknown>);
const kidObj = { id: 3, name: "Ivy", chores: [], devices: [] } as never;
const focus = { param: "kid", open: null, isOpen: () => false, openTo: () => {}, toggle: () => {}, close: () => {} };
const kf = <KidFocus kid={kidObj} requests={[]} chore={focus} />;
const choreOf = (state: string) => ({ id: 11, title: "Tidy", points: 5, state, can_move: false }) as never;
const co = (state: string) => <ChoreOpen chore={choreOf(state)} kid={kidObj} />;
const selfList = <SelfApprovedList kid={{ id: 3, full_name: "Ivy", trust_mode: false } as never} today="2026-11-10" />;
const menuHas = async (ui: React.ReactElement, name: string | RegExp, label: string, on: boolean) => {
  enabled = on;
  wrap(ui);
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/family"));
  await userEvent.click(await screen.findByRole("button", { name: label }));
  if (on) expect(await screen.findByRole("menuitem", { name })).toBeTruthy();
  else {
    await screen.findAllByRole("menuitem");
    expect(screen.queryByRole("menuitem", { name })).toBeNull();
  }
};

describe.each([true, false])("entries with penalties_enabled=%s", (on) => {
  test("KidFocus", () => menuHas(kf, /Give penalty/, "More for Ivy", on));
  test("TodayPage everyone", () => menuHas(<TodayPage />, /Penalty for everyone/, "More for Today", on));
  test("SelfApprovedList (via Wasn't done)", async () => {
    enabled = on;
    wrap(selfList);
    await userEvent.click(await screen.findByRole("button", { name: "More for Dishes" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Wasn't done" }));
    await screen.findByText(/goes back on|won't come back|were from/i).catch(() => null);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/family"));
    await waitFor(() => (on ? expect(screen.getByLabelText("Give penalty")) : expect(screen.queryByLabelText("Give penalty")).toBeNull()));
  });
  test.each(["needs_you", "done"])("ChoreOpen %s", async (state) => {
    enabled = on;
    wrap(co(state));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/family"));
    await screen.findByRole("button", { name: /Approve|Mark not done/ });
    await waitFor(() => (on ? expect(screen.getByRole("button", { name: /Give penalty/ })) : expect(screen.queryByRole("button", { name: /Give penalty/ })).toBeNull()));
  });
  test.each(["device_bypass", "device_resisting"])("InboxRow %s", async (kind) => {
    await menuHas(row(kind), /Give penalty/, "More for Alert", on);
  });
});

describe("payloads", () => {
  test("Today everyone sends all kid ids", async () => {
    enabled = true;
    wrap(<TodayPage />);
    await userEvent.click(await screen.findByRole("button", { name: "More for Today" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Penalty for everyone/ }));
    await screen.findByRole("button", { name: "Small" });
    await userEvent.click(document.querySelector(".p-pen-give")!);
    await waitFor(() => expect(posts()[0]?.kid_ids).toEqual([3, 4]), { timeout: 4000 });
  });
  test("ChoreOpen sends chore_run_id", async () => {
    enabled = true;
    wrap(co("needs_you"));
    await userEvent.click(await screen.findByRole("button", { name: /Give penalty/ }));
    await screen.findByRole("button", { name: "Small" });
    await userEvent.click(document.querySelector(".p-pen-give")!);
    await waitFor(() => expect(posts()[0]).toMatchObject({ kid_ids: [3], chore_run_id: 11 }), { timeout: 4000 });
  });
  test("InboxRow sends notification_id", async () => {
    enabled = true;
    wrap(row("device_resisting"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/family"));
    await new Promise((r) => setTimeout(r, 100));
    await userEvent.click(screen.getByRole("button", { name: "More for Alert" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Give penalty/ }));
    await screen.findByRole("button", { name: "Small" });
    await userEvent.click(document.querySelector(".p-pen-give")!);
    await waitFor(() => expect(posts()[0]).toMatchObject({ kid_ids: [3], notification_id: 1 }), { timeout: 4000 });
  });
  test("Wasn't done with the box ticked takes back, then gives with chore_run_id", async () => {
    enabled = true;
    wrap(wasnt);
    await userEvent.click(await screen.findByLabelText("Give penalty"));
    await screen.findByRole("button", { name: "Small" });
    expect(screen.queryByRole("button", { name: "Give penalty" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Wasn't done" }));
    await waitFor(() => expect(posts()[0]).toMatchObject({ kid_ids: [3], chore_run_id: 9, reason: "Said Dishes was done" }), { timeout: 4000 });
    expect(apiMock.mock.calls.some(([p]) => p === "/chores/9/take-back")).toBe(true);
  });
  test("Wasn't done unticked gives nothing", async () => {
    enabled = true;
    wrap(wasnt);
    await screen.findByLabelText("Give penalty");
    await userEvent.click(screen.getByRole("button", { name: "Wasn't done" }));
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p === "/chores/9/take-back")).toBe(true));
    expect(posts()).toHaveLength(0);
  });
  test("Wasn't done waits for the penalty draft while the box is ticked", async () => {
    enabled = true;
    const base = apiMock.getMockImplementation()!;
    apiMock.mockImplementation((p, i) => (p.startsWith("/penalties/options") ? new Promise(() => {}) : base(p, i)));
    wrap(wasnt);
    await userEvent.click(await screen.findByLabelText("Give penalty"));
    expect((screen.getByRole("button", { name: "Wasn't done" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

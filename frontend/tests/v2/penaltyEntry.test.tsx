import { beforeEach, describe, expect, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { api } from "@/v2/api";
import { WasntDoneSheet } from "@/v2/today/WasntDoneSheet";
import { WaitingActions } from "@/v2/today/WaitingActions";
import { InboxRow } from "@/v2/components/InboxRow";

jest.mock("@/v2/api", () => ({ api: jest.fn() }));
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));
jest.mock("@/v2/chat/dock", () => ({ openChat: jest.fn(), openChatAfterNav: jest.fn() }));
const apiMock = api as unknown as Mock<(p: string) => Promise<unknown>>;

let enabled = true;
beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (p: string) => {
    if (p === "/family") return { penalties_enabled: enabled };
    if (p === "/devices") return [{ id: 7, owner_ids: [3] }];
    if (p.startsWith("/penalties/options"))
      return { enabled: true, sizes: { small: { kind: "block", amount: 60, earn_back: "all" }, medium: { kind: "block", amount: 1440, earn_back: "half" }, big: { kind: "block", amount: 4320, earn_back: "none" } }, makeup_chores: [], kids: [{ id: 3, name: "Ivy", recent: 0, devices: [], groups: [] }] };
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

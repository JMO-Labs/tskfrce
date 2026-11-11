import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { api } from "@/v2/api";
import { PenaltySheet } from "@/v2/today/PenaltySheet";

jest.mock("@/v2/api", () => ({ api: jest.fn() }));
jest.mock("@mantine/notifications", () => ({
  notifications: { show: jest.fn() },
}));
const apiMock = api as unknown as Mock<
  (p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>
>;

const kid = (id: number, name: string) => ({
  id,
  name,
  recent: 0,
  devices: [],
  groups: [],
});
let goals: { id: number; name: string; saved: number; target: number }[] = [];
const options = () => ({
  enabled: true,
  sizes: {
    small: { kind: "points", amount: 20, earn_back: "all" },
    medium: { kind: "block", amount: 1440, earn_back: "half" },
    big: { kind: "block", amount: 4320, earn_back: "none" },
  },
  makeup_chores: ["Wipe counters"],
  kids: [kid(1, "Ivy"), kid(2, "Sam")],
  goals,
});
const show = (ids: number[], extra = {}) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MantineProvider>
        <PenaltySheet kidIds={ids} onClose={() => {}} {...extra} />
      </MantineProvider>
    </QueryClientProvider>,
  );
const posted = (path: string) =>
  apiMock.mock.calls.find(([p, i]) => p === path && i?.method === "POST")?.[1]?.body;

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
  global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  goals = [{ id: 7, name: "Disney trip", saved: 120, target: 300 }];
  apiMock
    .mockReset()
    .mockImplementation(async (p) => (p === "/penalties/options" ? options() : {}));
});

const openWhat = async (u: ReturnType<typeof userEvent.setup>) => {
  await screen.findByRole("button", { name: "Give penalty" });
  await u.click(screen.getAllByRole("button", { name: "change" })[0]);
};

describe("PenaltySheet family goal options", () => {
  test("take from a goal posts /penalties/goal with the reason", async () => {
    const u = userEvent.setup();
    show([1, 2]);
    await openWhat(u);
    await u.click(screen.getByRole("button", { name: "Take from goal" }));
    await u.click(screen.getByRole("button", { name: "More" }));
    await u.click(screen.getByRole("button", { name: /Add a reason/ }));
    expect(screen.getByText("−25 points from Disney trip")).toBeTruthy();
    await u.type(screen.getByLabelText("Reason"), "fighting");
    expect(screen.queryByText("Earn back all")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Give penalty" }));
    await waitFor(() =>
      expect(posted("/penalties/goal")).toEqual({
        goal_id: 7,
        mode: "take",
        amount: 25,
        reason: "fighting",
      }),
    );
    expect(posted("/penalties")).toBeUndefined();
  });

  test("raise target; several goals show a picker", async () => {
    goals.push({ id: 8, name: "Bike", saved: 0, target: 100 });
    const u = userEvent.setup();
    show([1, 2]);
    await openWhat(u);
    await u.click(screen.getByRole("button", { name: "Raise goal target" }));
    await u.click(screen.getByRole("button", { name: "Bike" }));
    await u.click(screen.getByRole("button", { name: /Add a reason/ }));
    expect(screen.getByText("Raise Bike by 20 points")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Give penalty" }));
    await waitFor(() =>
      expect(posted("/penalties/goal")).toEqual({ goal_id: 8, mode: "raise", amount: 20 }),
    );
  });

  test("picking a size drops the goal option", async () => {
    const u = userEvent.setup();
    show([1, 2]);
    await openWhat(u);
    await u.click(screen.getByRole("button", { name: "Take from goal" }));
    await u.click(screen.getByRole("button", { name: "Medium" }));
    await u.click(screen.getByRole("button", { name: "Give penalty" }));
    await waitFor(() => expect(posted("/penalties")).toBeTruthy());
    expect(posted("/penalties/goal")).toBeUndefined();
  });

  test("hidden for one kid, with no family goal, or inline", async () => {
    const u = userEvent.setup();
    const { unmount } = show([1]);
    await openWhat(u);
    expect(screen.queryByRole("button", { name: "Take from goal" })).toBeNull();
    unmount();
    goals = [];
    show([1, 2]);
    await openWhat(u);
    expect(screen.queryByRole("button", { name: "Take from goal" })).toBeNull();
  });
});

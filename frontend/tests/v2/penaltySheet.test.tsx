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

const kid = (id: number, name: string, recent = 0) => ({
  id,
  name,
  recent,
  devices: [{ id: 5, name: "Switch" }],
  groups: [{ id: 2, name: "Nintendo" }],
});
let kids = [kid(1, "Ivy"), kid(2, "Sam")];
const options = () => ({
  enabled: true,
  sizes: {
    small: { kind: "block", amount: 60, earn_back: "all" },
    medium: { kind: "block", amount: 1440, earn_back: "half" },
    big: { kind: "block", amount: 4320, earn_back: "none" },
  },
  makeup_chores: ["Wipe counters", "Sweep"],
  kids,
});
const show = (ids: number[], extra = {}) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MantineProvider>
        <PenaltySheet kidIds={ids} onClose={() => {}} {...extra} />
      </MantineProvider>
    </QueryClientProvider>,
  );
const posted = () =>
  apiMock.mock.calls.find(
    ([p, i]) => p === "/penalties" && i?.method === "POST",
  )?.[1]?.body;

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
  kids = [kid(1, "Ivy"), kid(2, "Sam")];
  apiMock
    .mockReset()
    .mockImplementation(async (p) =>
      p === "/penalties/options" ? options() : [],
    );
});

describe("PenaltySheet", () => {
  test("renders sizes, title and give button; Small preselected at recent=0", async () => {
    show([1]);
    expect(await screen.findByRole("dialog", { name: "Give Ivy a penalty" })).toBeTruthy();
    expect(screen.getByText("Give a penalty")).toBeTruthy();
    for (const n of ["Small", "Medium", "Big", "Custom"])
      expect(screen.getByRole("button", { name: n })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Give penalty" })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Small" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("recent=1 preselects Medium and shows 2nd this week", async () => {
    kids = [kid(1, "Ivy", 1)];
    show([1]);
    expect(await screen.findByText("2nd this week")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Medium" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  test("change on line 1 opens only line 1 editor; Custom opens it too", async () => {
    const u = userEvent.setup();
    show([1]);
    await screen.findByText("Give penalty", { selector: "button" });
    await u.click(screen.getAllByRole("button", { name: "change" })[0]);
    expect(screen.getByRole("button", { name: "Points" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Earn back half" })).toBeNull();
    expect(screen.queryByRole("button", { name: "No earn-back" })).toBeNull();
  });

  test("Custom opens line 1", async () => {
    const u = userEvent.setup();
    show([1]);
    await u.click(await screen.findByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: "Screen time" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Switch" })).toBeTruthy();
  });

  test("Give posts Medium body", async () => {
    const u = userEvent.setup();
    kids = [kid(1, "Ivy", 1)];
    show([1]);
    await u.click(await screen.findByRole("button", { name: "Give penalty" }));
    await waitFor(() =>
      expect(posted()).toEqual({
        kid_ids: [1],
        kind: "block",
        amount: 1440,
        earn_back: "half",
      }),
    );
  });

  test("reason is sent", async () => {
    const u = userEvent.setup();
    show([1]);
    await u.click(await screen.findByText(/Add a reason/));
    await u.type(screen.getByLabelText("Reason"), "Fibbed");
    await u.click(screen.getByRole("button", { name: "Give penalty" }));
    await waitFor(() =>
      expect((posted() as { reason: string }).reason).toBe("Fibbed"),
    );
  });

  test("family mode posts all kids and hides device chips", async () => {
    const u = userEvent.setup();
    show([1, 2]);
    expect(await screen.findByRole("dialog", { name: "Penalty for everyone" })).toBeTruthy();
    expect(screen.getByText("Everyone")).toBeTruthy();
    await u.click(await screen.findByRole("button", { name: "Custom" }));
    expect(screen.getByRole("button", { name: "Points" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Screen time" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "All devices" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nintendo" })).toBeNull();
    await u.click(screen.getByRole("button", { name: "Give penalty" }));
    await waitFor(() =>
      expect((posted() as { kid_ids: number[] }).kid_ids).toEqual([1, 2]),
    );
  });

  test("make-up picks are capped at five", async () => {
    kids = [kid(1, "Ivy")];
    const many = ["a", "b", "c", "d", "e", "f"];
    apiMock.mockImplementation(async (p) =>
      p === "/penalties/options" ? { ...options(), makeup_chores: many } : [],
    );
    const u = userEvent.setup();
    show([1]);
    await screen.findByText("Give penalty", { selector: "button" });
    await u.click(screen.getAllByRole("button", { name: "change" })[1]);
    for (const c of many)
      await u.click(screen.getByRole("button", { name: c }));
    expect(
      within(document.body)
        .getAllByRole("button", { pressed: true })
        .filter((b) => many.includes(b.textContent ?? "")),
    ).toHaveLength(5);
  });

  test("stale make-up picks are not posted when earn-back is none", async () => {
    const u = userEvent.setup();
    show([1]);
    await screen.findByText("Give penalty", { selector: "button" });
    await u.click(screen.getAllByRole("button", { name: "change" })[1]);
    await u.click(screen.getByRole("button", { name: "Sweep" }));
    await u.click(screen.getByRole("button", { name: "No earn-back" }));
    await u.click(screen.getByRole("button", { name: "Give penalty" }));
    await waitFor(() => expect(posted()).toBeTruthy());
    expect(posted()).not.toHaveProperty("makeup");
  });
});

import type { ReactNode } from "react";
import {
  earnLine,
  duration,
  goalLine,
  stepAmount,
  whatLine,
  type EarnBack,
  type GoalMode,
  type PenaltyDraft,
  type PenaltyGoal,
  type PenaltyKind,
  type PenaltyOptions,
} from "../penaltyTypes";

type Kid = PenaltyOptions["kids"][number];
export type PenLine = "what" | "earn" | "reason";
export const MAX_MAKEUP = 5;

const Chip = ({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    className="p-pen-chip"
    data-on={on}
    aria-pressed={on}
    onClick={onClick}
  >
    {children}
  </button>
);

const Row = ({
  text,
  action,
  onOpen,
  em,
}: {
  text: string;
  action: string;
  onOpen: () => void;
  em?: boolean;
}) => (
  <div className="p-pen-sum">
    {em ? <em>{text}</em> : <span>{text}</span>}
    <button type="button" className="p-pen-link" onClick={onOpen}>
      {action}
    </button>
  </div>
);

const unit = (d: PenaltyDraft) =>
  d.kind === "points"
    ? `${d.amount} points`
    : d.kind === "screen"
      ? `${d.amount} min`
      : duration(d.amount);

export function deviceLabel(d: PenaltyDraft, kid?: Kid): string {
  if (d.group_id)
    return kid?.groups.find((g) => g.id === d.group_id)?.name ?? "";
  if (d.device_id)
    return kid?.devices.find((x) => x.id === d.device_id)?.name ?? "";
  return "";
}

interface WhatProps {
  draft: PenaltyDraft;
  kid?: Kid;
  open: boolean;
  onOpen: () => void;
  onChange: (p: Partial<PenaltyDraft>) => void;
  /** family sheet only: live family goals to take from or raise */
  goals?: PenaltyGoal[];
}

const DEFAULT_AMOUNT: Record<PenaltyKind, number> = {
  points: 20,
  screen: 30,
  block: 1440,
};

export function WhatLine({ draft, kid, open, onOpen, onChange, goals = [] }: WhatProps) {
  if (!open)
    return (
      <Row
        text={
          draft.goal
            ? goalLine(draft, goals)
            : whatLine(draft, deviceLabel(draft, kid))
        }
        action="change"
        onOpen={onOpen}
      />
    );
  const setKind = (kind: PenaltyKind, extra: Partial<PenaltyDraft> = {}) =>
    onChange({
      kind,
      amount: draft.kind === kind ? draft.amount : DEFAULT_AMOUNT[kind],
      device_id: null,
      group_id: null,
      goal: null,
      ...extra,
    });
  const setGoal = (mode: GoalMode, id = draft.goal?.id ?? goals[0].id) =>
    onChange({
      kind: "points",
      amount: draft.kind === "points" ? draft.amount : DEFAULT_AMOUNT.points,
      device_id: null,
      group_id: null,
      goal: { id, mode },
    });
  const allDevices =
    draft.kind === "block" && !draft.device_id && !draft.group_id;
  const mode = draft.goal?.mode;
  return (
    <div className="p-pen-edit">
      <div className="p-pen-chips">
        <Chip
          on={draft.kind === "points" && !draft.goal}
          onClick={() => setKind("points")}
        >
          Points
        </Chip>
        <Chip on={draft.kind === "screen"} onClick={() => setKind("screen")}>
          Screen time
        </Chip>
        {goals.length > 0 && (
          <>
            <Chip on={mode === "take"} onClick={() => setGoal("take")}>
              Take from a goal
            </Chip>
            <Chip on={mode === "raise"} onClick={() => setGoal("raise")}>
              Raise a goal&apos;s target
            </Chip>
          </>
        )}
        {kid?.groups.map((g) => (
          <Chip
            key={`g${g.id}`}
            on={draft.group_id === g.id}
            onClick={() => setKind("block", { group_id: g.id })}
          >
            {g.name}
          </Chip>
        ))}
        <Chip on={allDevices} onClick={() => setKind("block")}>
          All devices
        </Chip>
        {kid?.devices.map((x) => (
          <Chip
            key={`d${x.id}`}
            on={draft.device_id === x.id}
            onClick={() => setKind("block", { device_id: x.id })}
          >
            {x.name}
          </Chip>
        ))}
      </div>
      {mode && goals.length > 1 && (
        <div className="p-pen-chips">
          {goals.map((g) => (
            <Chip
              key={g.id}
              on={draft.goal?.id === g.id}
              onClick={() => setGoal(mode, g.id)}
            >
              {g.name}
            </Chip>
          ))}
        </div>
      )}
      <div className="p-pen-step">
        <button
          type="button"
          aria-label="Less"
          onClick={() =>
            onChange({ amount: stepAmount(draft.kind, draft.amount, -1) })
          }
        >
          −
        </button>
        <b>{unit(draft)}</b>
        <button
          type="button"
          aria-label="More"
          onClick={() =>
            onChange({ amount: stepAmount(draft.kind, draft.amount, 1) })
          }
        >
          +
        </button>
      </div>
    </div>
  );
}

interface EarnProps {
  draft: PenaltyDraft;
  makeupChores: string[];
  open: boolean;
  onOpen: () => void;
  onChange: (p: Partial<PenaltyDraft>) => void;
}

export function EarnLine({
  draft,
  makeupChores,
  open,
  onOpen,
  onChange,
}: EarnProps) {
  const picks = draft.makeup ?? [];
  if (!open)
    return (
      <Row text={earnLine(draft.earn_back)} action="change" onOpen={onOpen} />
    );
  const toggle = (c: string) =>
    onChange({
      makeup: picks.includes(c)
        ? picks.filter((x) => x !== c)
        : picks.length < MAX_MAKEUP
          ? [...picks, c]
          : picks,
    });
  return (
    <div className="p-pen-edit">
      <div className="p-pen-chips">
        {(["none", "half", "all"] as EarnBack[]).map((e) => (
          <Chip
            key={e}
            on={draft.earn_back === e}
            onClick={() => onChange({ earn_back: e })}
          >
            {e === "none"
              ? "No earn-back"
              : e === "half"
                ? "Earn back half"
                : "Earn back all"}
          </Chip>
        ))}
      </div>
      {draft.earn_back !== "none" && makeupChores.length > 0 && (
        <>
          <div className="p-pen-lbl">Earn it back by doing</div>
          <div className="p-pen-chips">
            {makeupChores.map((c) => (
              <Chip key={c} on={picks.includes(c)} onClick={() => toggle(c)}>
                {c}
              </Chip>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface ReasonProps {
  value: string;
  name: string;
  open: boolean;
  onOpen: () => void;
  onChange: (v: string) => void;
}

export function ReasonLine({
  value,
  name,
  open,
  onOpen,
  onChange,
}: ReasonProps) {
  if (open)
    return (
      <div className="p-pen-edit">
        <input
          className="p-pen-input"
          aria-label="Reason"
          autoFocus
          maxLength={200}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Reason ${name} sees`}
        />
      </div>
    );
  if (value) return <Row text={`“${value}”`} action="edit" onOpen={onOpen} />;
  return (
    <div className="p-pen-sum">
      <button type="button" className="p-pen-plain" onClick={onOpen}>
        + Add a reason {name} sees
      </button>
    </div>
  );
}

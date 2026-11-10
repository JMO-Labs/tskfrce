import { useState } from "react";
import { Modal } from "@mantine/core";
import {
  useGivePenalty,
  usePenaltyOptions,
  type GiveBody,
} from "../hooks/usePenalties";
import {
  presetFor,
  repeatHint,
  type PenaltyDraft,
  type PenaltyOptions,
  type SizeKey,
} from "../penaltyTypes";
import { EarnLine, ReasonLine, WhatLine, type PenLine } from "./PenaltyLines";

export interface PenaltyFrom {
  chore_run_id?: number;
  notification_id?: number;
}
interface Props {
  kidIds: number[];
  onClose: () => void;
  from?: PenaltyFrom;
  reason?: string;
  /** render without the Modal (inside another sheet) */
  inline?: boolean;
}

type Pick = SizeKey | "custom";
const SEGS: { v: Pick; label: string }[] = [
  { v: "small", label: "Small" },
  { v: "medium", label: "Medium" },
  { v: "big", label: "Big" },
  { v: "custom", label: "Custom" },
];

function Body({
  kidIds,
  onClose,
  from,
  reason: r0 = "",
  opts,
}: Props & { opts: PenaltyOptions }) {
  const give = useGivePenalty();
  const kids = opts.kids.filter((k) => kidIds.includes(k.id));
  const family = kidIds.length > 1;
  const kid = family ? undefined : kids[0];
  const recent = Math.max(0, ...kids.map((k) => k.recent));
  const first = presetFor(recent);
  const [pick, setPick] = useState<Pick>(first);
  const [draft, setDraft] = useState<PenaltyDraft>({
    ...opts.sizes[first],
    reason: r0,
  });
  const [open, setOpen] = useState<PenLine | null>(r0 ? "reason" : null);
  const hint = repeatHint(recent);

  const choose = (p: Pick) => {
    setPick(p);
    if (p === "custom") return setOpen("what");
    setDraft((d) => ({ ...opts.sizes[p], reason: d.reason, makeup: d.makeup }));
    setOpen((o) => (o === "what" ? null : o));
  };
  const edit = (patch: Partial<PenaltyDraft>) => {
    setPick("custom");
    setDraft((d) => ({ ...d, ...patch }));
  };
  const submit = () => {
    const { reason, device_id, group_id, makeup, ...core } = draft;
    const body = {
      kid_ids: kidIds,
      ...core,
      ...(reason.trim() && { reason: reason.trim() }),
      ...(device_id && { device_id }),
      ...(group_id && { group_id }),
      ...(makeup?.length && { makeup }),
      ...from,
    };
    give.mutate(body as GiveBody, { onSuccess: onClose });
  };
  const toggle = (l: PenLine) => () => setOpen((o) => (o === l ? null : l));
  const name = family ? "everyone" : (kid?.name ?? "");
  return (
    <div className="p-pen-sheet">
      <div className="p-pen-bar">
        <div className="p-pen-seg" role="group" aria-label="Size">
          {SEGS.map((s) => (
            <button
              key={s.v}
              type="button"
              aria-pressed={pick === s.v}
              data-active={pick === s.v}
              onClick={() => choose(s.v)}
            >
              {s.label}
            </button>
          ))}
        </div>
        {hint && <span className="p-pen-hint">{hint}</span>}
      </div>
      <div className="p-pen-lines">
        <WhatLine
          draft={draft}
          kid={kid}
          open={open === "what"}
          onOpen={toggle("what")}
          onChange={edit}
        />
        <EarnLine
          draft={draft}
          makeupChores={opts.makeup_chores}
          open={open === "earn"}
          onOpen={toggle("earn")}
          onChange={(p) => setDraft((d) => ({ ...d, ...p }))}
        />
        <ReasonLine
          value={draft.reason}
          name={name}
          open={open === "reason"}
          onOpen={toggle("reason")}
          onChange={(reason) => setDraft((d) => ({ ...d, reason }))}
        />
      </div>
      <button
        type="button"
        className="p-pen-give"
        disabled={give.isPending}
        aria-busy={give.isPending}
        onClick={submit}
      >
        Give penalty
      </button>
    </div>
  );
}

/** The compact "give a penalty" sheet: pick a size, change a line only if needed, send. */
export function PenaltySheet(props: Props) {
  const { data } = usePenaltyOptions(true);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  const close = () => {
    props.onClose();
    requestAnimationFrame(() => opener?.isConnected && opener.focus());
  };
  const one = data?.kids.find((k) => k.id === props.kidIds[0]);
  const title =
    props.kidIds.length > 1
      ? "Penalty for everyone"
      : `Give ${one?.name ?? ""} a penalty`.replace("  ", " ");
  const body = data ? (
    <Body
      {...props}
      onClose={props.inline ? props.onClose : close}
      opts={data}
    />
  ) : null;
  if (props.inline) return body;
  return (
    <Modal opened onClose={close} title={title} centered>
      {body}
    </Modal>
  );
}

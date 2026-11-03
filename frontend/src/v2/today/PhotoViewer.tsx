import { useEffect, useState } from "react";
import { useOnChange } from "@/v2/hooks/useOnChange";
import { useResetState } from "@/v2/hooks/useResetState";
import { openChat } from "@/v2/chat/dock";
import { Modal, Textarea } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { tokenManager } from "@/services/tokenManager";
import { kidToken } from "../api";
import type { NeedsItem } from "../types";
import { Icon } from "../parent/Icon";

/** Fetch an authed image through the proxy and expose it as a blob URL. */
export function useAuthImage(path: string | null | undefined) {
  const [loaded, setLoaded] = useState<{ path: string; url: string } | null>(null);
  const src = loaded && loaded.path === path ? loaded.url : null; // never show the previous (revoked) blob
  useEffect(() => {
    if (!path) return;
    let url: string | null = null;
    let live = true;
    const token = tokenManager.getAccessToken() ?? kidToken(); // kid sessions have no parent token
    fetch(`/api/proxy${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error("photo"))))
      .then((b) => {
        url = URL.createObjectURL(b);
        if (live) setLoaded({ path, url });
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  return src;
}

export interface ViewerPhoto {
  id: number;
  thumb_url: string;
  /** from a sent-back attempt */
  earlier?: boolean;
}

/** Full-screen (phones) photo viewer: pages through `photos`; with onApprove / onSendBack it also decides (sending back needs a note). */
export function PhotoViewer({
  item,
  photos,
  start = 0,
  onClose,
  onApprove,
  onSendBack,
}: {
  item: NeedsItem | null;
  /** All photos of the run; defaults to the item's own thumbnail. */
  photos?: ViewerPhoto[];
  start?: number;
  onClose: () => void;
  onApprove?: (id: number) => void;
  onSendBack?: (id: number, note: string) => void;
}) {
  const [note, setNote] = useState("");
  const [idx, setIdx] = useResetState(start, `${item?.id}:${start}`);
  const [replied, setReplied] = useState(false); // Reply moves focus to the chat composer, so the thumbnail must not take it back
  useOnChange(item, (i) => i && setReplied(false)); // not when it closes: Reply sets it as the viewer goes away
  const phone = useMediaQuery("(max-width: 767px)");
  const list = photos ?? (item?.thumb_url ? [{ id: Number(item.thumb_url.match(/chore-photos\/(\d+)/)?.[1]) || 0, thumb_url: item.thumb_url }] : []);
  const shown = list[Math.min(idx, list.length - 1)];
  const src = useAuthImage(shown?.thumb_url.replace(/\/thumb$/, ""));
  const close = () => {
    setNote("");
    onClose();
  };
  const step = (d: number) => setIdx((i) => (i + d + list.length) % list.length);
  return (
    <Modal
      opened={!!item}
      onClose={close}
      zIndex={400}
      fullScreen={!!phone}
      returnFocus={!replied}
      transitionProps={{ duration: 0 }}
      classNames={{ title: "pt-pv-title" }}
      title={item ? `${item.kid_name ?? "A kid"} · ${item.title}` : ""}
    >
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={item?.title ?? "Chore photo"} style={{ width: "100%", borderRadius: 6 }} />
      )}
      {list.length > 1 && (
        <div className="pt-pv-pager">
          <button type="button" className="p-btn" aria-label="Previous photo" onClick={() => step(-1)}>
            <Icon name="chevron_left" size={17} />
          </button>
          <span aria-live="polite">
            Photo {idx + 1} of {list.length}
            {shown?.earlier && " · Earlier try"}
          </span>
          <button type="button" className="p-btn" aria-label="Next photo" onClick={() => step(1)}>
            <Icon name="chevron_right" size={17} />
          </button>
        </div>
      )}
      {onSendBack && (
        <Textarea
          label="Note for sending back"
          value={note}
          onChange={(e) => setNote(e.currentTarget.value)}
          maxLength={500}
          mt="sm"
        />
      )}
      <div className="pt-pv-acts">
        {onApprove && (
          <button
            type="button"
            className="p-btn"
            data-variant="accent"
            onClick={() => {
              if (item) onApprove(item.id);
              close();
            }}
          >
            <Icon name="check" size={16} />
            Approve
          </button>
        )}
        {onSendBack && (
          <button
            type="button"
            className="p-btn"
            disabled={!note.trim()}
            onClick={() => {
              if (item) onSendBack(item.id, note.trim());
              close();
            }}
          >
            <Icon name="undo" size={16} />
            Send back
          </button>
        )}
        {item && (
          <button
            type="button"
            className="p-btn"
            onClick={() => {
              setReplied(true);
              openChat("chore", String(item.id), { proof_photo_id: shown?.id || undefined, label: `Photo ${idx + 1}` });
              close();
            }}
          >
            <Icon name="chat" size={16} />
            Reply
          </button>
        )}
      </div>
    </Modal>
  );
}

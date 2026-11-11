import { useEffect, useState } from "react"
import { useRouter } from "next/router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../api"
import { Icon } from "../parent/Icon"
import { MakerLogo } from "../parent/MakerLogo"
import { LoadFail } from "../parent/states"
import { toastFail } from "../notify"
import { DEVICE_TYPE_ICON, getDeviceType } from "../manage/deviceMeta"
import { isPrivateMac } from "../manage/privateMac"
import type { Device, Kid } from "../types"
import styles from "./devices.module.css"

export function StepDevices({ kids }: { kids: Kid[] }) {
  const router = useRouter()
  const qc = useQueryClient()
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null)
  const [rescanning, setRescanning] = useState(false)
  const [showPrivateHelp, setShowPrivateHelp] = useState(false)
  const [openPopupId, setOpenPopupId] = useState<number | null>(null)
  const list = useQuery({
    queryKey: ["setup-devices"],
    queryFn: () => api<Device[]>("/devices"),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  useEffect(() => {
    if (secondsAgo === null) return
    const timer = setInterval(() => setSecondsAgo((s) => (s !== null ? s + 1 : null)), 1000)
    return () => clearInterval(timer)
  }, [secondsAgo])
  const devices = list.data ?? []
  const needOwner = devices.filter((d) => d.status === "unassigned")
  const done = devices.filter((d) => d.status !== "unassigned")
  const selectedTab = (router.query.open as string) || (needOwner.length > 0 ? "need" : "done")
  const networkLabels = new Set(devices.map((d) => d.network || null))
  const showHeaders = networkLabels.size > 1
  const visibleDevices = selectedTab === "need" ? needOwner : done
  const groups = Array.from(networkLabels)
    .sort((a, b) => {
      if (a === null) return -1
      if (b === null) return 1
      return (a || "").localeCompare(b || "")
    })
    .map((label) => ({
      label,
      devices: visibleDevices.filter((d) => (d.network || null) === label),
    }))
  const handleRescan = async () => {
    setRescanning(true)
    try {
      await api("/devices/rescan", { method: "POST" })
      setSecondsAgo(0)
      setTimeout(() => qc.invalidateQueries({ queryKey: ["setup-devices"] }), 500)
    } catch (err) {
      console.error("Rescan failed:", err)
    } finally {
      setRescanning(false)
    }
  }
  const canRescan = secondsAgo === null || secondsAgo >= 10
  const deviceRow = (d: Device) => {
    const displayName = d.display_name || d.name
    const isPrivate = isPrivateMac(d.mac)
    const owner = d.owner_ids.length > 0 ? kids.find((k) => k.id === d.owner_ids[0]) : undefined
    const ownerName = owner ? `${owner.full_name}` : ""
    const isOpen = openPopupId === d.id
    const handleSelectOwner = async (status: "assigned" | "guest" | "unassigned", owner_ids: number[]) => {
      try {
        await api(`/devices/${d.id}`, {
          method: "PATCH",
          body: { status, owner_ids },
        })
        qc.invalidateQueries({ queryKey: ["setup-devices"] })
        setOpenPopupId(null)
      } catch (error) {
        toastFail(error instanceof Error ? error.message : "Failed to update device")
      }
    }
    return (
      <>
        <div key={d.id} className={styles.deviceItem}>
          <div className={styles.deviceIcon}>
            <Icon name={DEVICE_TYPE_ICON[getDeviceType(displayName, d.vendor)]} size={18} />
            {(d.vendor || d.maker_guess) && <span className={styles.makerLogo}><MakerLogo vendor={d.vendor || null} size={9} /></span>}
          </div>
          <div className={styles.deviceInfo}>
            <div className={styles.deviceName}>
              {displayName}
              {isPrivate && <span className={styles.privateTag}>private</span>}
            </div>
            <div className={styles.deviceMeta}>
              {isPrivate ? "Open t@sk4ce on this device to claim it" : d.vendor && d.ip ? `${d.vendor} · ${d.ip}` : d.ip || ""}
            </div>
          </div>
          <button
            type="button"
            className={styles.devicePopup}
            title={`Assign owner for ${displayName}`}
            aria-label={owner ? `Owner for ${displayName}: ${ownerName}` : `Owner for ${displayName}`}
            onClick={() => setOpenPopupId(isOpen ? null : d.id)}
          >
            <Icon name={owner ? "person" : "add"} size={16} />
            <span>{ownerName || "Owner"}</span>
          </button>
        </div>
        {isOpen && (
          <div role="group" aria-label={`Owner for ${displayName}`} className={styles.ownerPopup}>
            {kids.map((kid) => (
              <button
                key={kid.id}
                type="button"
                className={styles.ownerOption}
                aria-pressed="false"
                onClick={() => void handleSelectOwner("assigned", [kid.id])}
              >
                {kid.full_name}
              </button>
            ))}
            <button
              type="button"
              className={styles.ownerOption}
              aria-pressed="false"
              onClick={() => void handleSelectOwner("guest", [])}
            >
              Guest (never blocked)
            </button>
            <button
              type="button"
              className={styles.ownerOption}
              aria-pressed="false"
              onClick={() => void handleSelectOwner("unassigned", [])}
            >
              Not sure yet
            </button>
          </div>
        )}
      </>
    )
  }
  const deviceNames = visibleDevices.slice(0, 2).map((d) => d.display_name || d.name).join(", ")
  const moreCount = visibleDevices.length - 2
  const deviceLine = needOwner.length === 0 ? "All devices have an owner" : visibleDevices.length <= 2 ? deviceNames : `${deviceNames} +${moreCount} more`
  const privateDevices = devices.filter((d) => isPrivateMac(d.mac))
  return (
    <>
      {list.isError && <LoadFail error={list.error} onRetry={() => void list.refetch()} />}
      <div className={styles.scanStatus}>
        {list.isPending && <span className={styles.scanPulse} aria-hidden="true" />}
        {devices.length > 0 && <span>Looking for devices… {devices.length} found</span>}
      </div>
      {devices.length > 0 ? (
        <>
          <div className={styles['p-srows']} data-grp>
            <button
              className={`${styles.rowTab} ${selectedTab === "need" ? styles.active : ""}`}
              onClick={() => void router.replace({ query: { ...router.query, open: "need" } })}
            >
              <span>Need an owner</span> · {needOwner.length} left
            </button>
            <button
              className={`${styles.rowTab} ${selectedTab === "done" ? styles.active : ""}`}
              onClick={() => void router.replace({ query: { ...router.query, open: "done" } })}
            >
              <span>Done</span> · {done.length}
            </button>
          </div>
          <div className={styles.rowInfo}>{deviceLine}</div>
          <div className={styles.deviceGroups}>
            {groups.map((group) => (
              <div key={group.label || "untagged"} className={styles.networkSection}>
                {showHeaders && group.label && <div className={styles.networkHeader}>{group.label}</div>}
                {group.devices.map(deviceRow)}
              </div>
            ))}
          </div>
        </>
      ) : !list.isPending ? (
        <p className={styles.noDevices}>No devices yet. Unlock a device and open a web page, or skip and add them later.</p>
      ) : null}
      <div className={styles.helpSection}>
        <p className={styles.helpText}>Not seeing a device, or one keeps changing?</p>
        <button className={styles.moreButton} onClick={() => setShowPrivateHelp(!showPrivateHelp)}>
          More
        </button>
        {showPrivateHelp && (
          <div className={styles.helpContent}>
            <p>Unlock it and open a web page to claim it, or we&rsquo;ll assign it later.</p>
            {privateDevices.length > 0 && <p>{privateDevices.length} of these use a private Wi-Fi address</p>}
          </div>
        )}
      </div>
      <button className={styles.rescanButton} onClick={handleRescan} disabled={!canRescan || rescanning}>
        <Icon name="refresh-cw" size={14} />
        Rescan{secondsAgo !== null && ` - Last scan ${secondsAgo} s ago`}
      </button>
      <div className={styles.note}>Router and this box are hidden.</div>
    </>
  )
}

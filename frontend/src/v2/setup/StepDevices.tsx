import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../api"
import { Icon } from "../parent/Icon"
import { MakerLogo } from "../parent/MakerLogo"
import { LoadFail } from "../parent/states"
import { DEVICE_TYPE_ICON, getDeviceType } from "../manage/deviceMeta"
import { isPrivateMac } from "../manage/privateMac"
import type { Device, Kid } from "../types"
import styles from "./devices.module.css"

export function StepDevices({ kids }: { kids: Kid[] }) {
  const qc = useQueryClient()
  const [secondsAgo, setSecondsAgo] = useState<number | null>(null)
  const [rescanning, setRescanning] = useState(false)
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
  const networkLabels = new Set(devices.map((d) => d.network || null))
  const showHeaders = networkLabels.size > 1
  const groups = Array.from(networkLabels)
    .sort((a, b) => {
      if (a === null) return -1
      if (b === null) return 1
      return (a || "").localeCompare(b || "")
    })
    .map((label) => ({
      label,
      devices: devices.filter((d) => (d.network || null) === label),
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
    return (
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
          <div className={styles.deviceMeta}>{isPrivate ? "Open t@sk4ce on this device to claim it" : d.ip || ""}</div>
        </div>
        <button type="button" className={styles.devicePopup} title={`Assign owner for ${displayName}`} onClick={() => {
          const newValue = d.owner_ids[0]?.toString() || ""
          void api(`/devices/${d.id}`, {
            method: "PATCH",
            body: { status: newValue ? "assigned" : "unassigned", owner_ids: newValue ? [Number(newValue)] : [] },
          }).then(() => qc.invalidateQueries({ queryKey: ["setup-devices"] }))
        }}><Icon name="plus" size={16} /></button>
      </div>
    )
  }
  return (
    <>
      {list.isError && <LoadFail error={list.error} onRetry={() => void list.refetch()} />}
      <div className={styles.scanStatus}>
        {list.isPending && (<><span className={styles.scanPulse} aria-hidden="true" /><span>Looking for devices...</span></> )}
        {!list.isPending && devices.length > 0 && <span>{devices.length} found</span>}
      </div>
      {devices.length > 0 ? (
        <div className={styles.deviceGroups}>
          {groups.map((group) => (
            <div key={group.label || "untagged"} className={styles.networkSection}>
              {showHeaders && group.label && <div className={styles.networkHeader}>{group.label}</div>}
              {group.devices.map(deviceRow)}
            </div>
          ))}
        </div>
      ) : !list.isPending ? (
        <p className={styles.noDevices}>No devices yet.</p>
      ) : null}
      <button className={styles.rescanButton} onClick={handleRescan} disabled={!canRescan || rescanning}>
        <Icon name="refresh-cw" size={14} />
        Rescan{secondsAgo !== null && ` - Last scan ${secondsAgo} s ago`}
      </button>
      <div className={styles.note}>Router and this box are hidden.</div>
    </>
  )
}

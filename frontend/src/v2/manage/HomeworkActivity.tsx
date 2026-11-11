import { useState } from 'react'
import { useOverride } from '../hooks/useOverride'
import { useHomeworkActivity, useHomeworkSite } from '../hooks/useHomework'
import { Icon } from '../parent/Icon'
import { toastFail, toastOk } from '../notify'

export function HomeworkActivity({ deviceId, kidId }: { deviceId?: number; kidId?: number }) {
  const { data: sessions } = useHomeworkActivity({ deviceId, kidId })
  const site = useHomeworkSite()
  const override = useOverride()
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)

  if (!sessions || sessions.length === 0) return null

  const session = sessions[0]
  if (!session.items || session.items.length === 0) return null

  const sortedItems = [...session.items].sort((a, b) => b.active_minutes - a.active_minutes)

  const handleBlock = (domain: string) => {
    site
      .mutateAsync({ action: 'add', domain, kind: 'block' })
      .then(() => toastOk('Blocked'), toastFail)
      .catch(() => {})
  }

  const handleAdd = (domain: string, kidId?: number | null) => {
    site
      .mutateAsync({ action: 'add', domain, kind: 'allow', kid_id: kidId })
      .then(() => toastOk('Added'), toastFail)
      .catch(() => {})
  }

  const handleEnd = () => {
    override
      .mutateAsync({
        target: { kind: 'device', id: session.device_id },
        choice: { action: 'clear' },
      })
      .catch(() => {})
  }

  return (
    <section className="pk-panel" aria-label="Homework activity">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Icon name="schedule" size={18} />
          Homework activity
        </h3>
        <button
          type="button"
          className="p-btn"
          onClick={handleEnd}
          disabled={override.isPending}
        >
          End homework mode
        </button>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {sortedItems.map((item) => (
          <li key={item.domain} style={{ padding: '12px', borderBottom: '1px solid #eee' }}>
            <div>
              <div style={{ fontWeight: 500 }}>{item.domain} · {item.active_minutes} min</div>
              {item.via === 'follow' && item.pulled_by && (
                <div style={{ fontSize: '0.875em', color: '#666', marginTop: '4px' }}>
                  pulled in by {item.pulled_by}
                </div>
              )}
              {expandedDomain === item.domain && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    type="button"
                    className="p-btn"
                    onClick={() => {
                      handleBlock(item.domain)
                      setExpandedDomain(null)
                    }}
                    disabled={site.isPending}
                  >
                    Block
                  </button>
                  {session.kid_id ? (
                    <>
                      <button
                        type="button"
                        className="p-btn"
                        onClick={() => {
                          handleAdd(item.domain, session.kid_id)
                          setExpandedDomain(null)
                        }}
                        disabled={site.isPending}
                      >
                        Just for {session.kid_name}
                      </button>
                      <button
                        type="button"
                        className="p-btn"
                        onClick={() => {
                          handleAdd(item.domain, null)
                          setExpandedDomain(null)
                        }}
                        disabled={site.isPending}
                      >
                        For everyone
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="p-btn"
                      onClick={() => {
                        handleAdd(item.domain, null)
                        setExpandedDomain(null)
                      }}
                      disabled={site.isPending}
                    >
                      For everyone
                    </button>
                  )}
                </div>
              )}
              {expandedDomain !== item.domain && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    type="button"
                    className="p-btn"
                    onClick={() => setExpandedDomain(item.domain)}
                  >
                    Block
                  </button>
                  <button
                    type="button"
                    className="p-btn"
                    onClick={() => setExpandedDomain(item.domain)}
                  >
                    Add to allowed
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p style={{ fontSize: '0.875em', color: '#666', marginTop: '12px', marginBottom: 0 }}>
        Sites that share servers with an allowed site may still load.
      </p>
    </section>
  )
}

import { Icon } from '@/v2/parent/Icon'
import { useAuthImage } from '@/v2/today/PhotoViewer'
import type { Block } from './types'

interface Props {
  block: Block
  onPress: (buttonId: string) => void
  pending?: boolean
  /** Kid surface: buttons only ask, and read that way. */
  kid?: boolean
}

function host(link: string): string | null {
  try {
    return new URL(link).hostname
  } catch {
    return null
  }
}

function Img({ url, alt }: { url: string; alt: string }) {
  const src = useAuthImage(url)
  if (!src) return <div className="iw-img iw-img-wait" role="img" aria-label={alt} />
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="iw-img" src={src} alt={alt} />
}

/** Renders the closed set of widget blocks. Everything is plain text; unknown types render nothing. */
export function WidgetBlocks({ block, onPress, pending, kid }: Props) {
  switch (block.type) {
    case 'card':
      return (
        <div className="iw-card">
          {block.title && <h3 className="iw-title">{block.title}</h3>}
          {block.children?.map((c, i) => (
            <WidgetBlocks key={i} block={c} onPress={onPress} pending={pending} kid={kid} />
          ))}
        </div>
      )
    case 'text': {
      const h = block.link ? host(block.link) : null
      return (
        <p className="iw-text" data-tone={block.tone ?? 'normal'}>
          {block.text}
          {block.link && h && (
            <a className="iw-link" href={block.link} target="_blank" rel="noopener noreferrer nofollow">
              <Icon name="open_in_new" size={15} />
              <span>{h}</span>
            </a>
          )}
        </p>
      )
    }
    case 'list':
      return (
        <ul className="iw-list-items">
          {block.items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )
    case 'stat':
      return (
        <div className="iw-stat">
          <span className="iw-stat-v">{block.value}</span>
          <span className="iw-stat-l">{block.label}</span>
        </div>
      )
    case 'progress': {
      const pct = block.max > 0 ? Math.min(100, Math.max(0, (block.value / block.max) * 100)) : 0
      return (
        <div className="iw-prog">
          <div className="iw-prog-row">
            <span>{block.label}</span>
            <span className="iw-prog-n">
              {block.value} / {block.max}
            </span>
          </div>
          <div
            className="iw-track"
            role="progressbar"
            aria-label={block.label}
            aria-valuemin={0}
            aria-valuemax={block.max}
            aria-valuenow={block.value}
          >
            <div className="iw-meter" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )
    }
    case 'image':
      return <Img url={block.url} alt={block.alt} />
    case 'button':
      if (kid)
        return (
          <button type="button" className="r-btn iw-btn iw-ask" data-tone="plain" disabled={pending} onClick={() => onPress(block.id)}>
            <span className="iw-ask-tag">Ask</span>
            <span className="iw-ask-label">{block.label}</span>
          </button>
        )
      return (
        <button type="button" className="p-btn iw-btn" disabled={pending} onClick={() => onPress(block.id)}>
          {block.label}
        </button>
      )
    default:
      return null
  }
}

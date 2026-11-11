import type { Micro } from '../types'
import { sockSnatch } from './SockSnatch'
import { plateTower } from './PlateTower'
import { bubblePop } from './BubblePop'
import { quickDraw } from './QuickDraw'
import { sweepSwipe } from './SweepSwipe'
import { flip } from './Flip'
import { plug } from './Plug'
import { zip } from './Zip'
import { squeeze } from './Squeeze'
import { dodge } from './Dodge'
import { water } from './Water'
import { hang } from './Hang'
import { shh } from './Shh'
import { catchKeys } from './Catch'
import { match } from './Match'
import { fold } from './Fold'
import { feed } from './Feed'
import { spot } from './Spot'
import { count } from './Count'
import { catDash } from './CatDash'

/** The 20 microgames, in spec order (matches backend MICRO). */
export const MICROS: Micro[] = [
  sockSnatch, plateTower, bubblePop, quickDraw, sweepSwipe, flip, plug, zip, squeeze, dodge,
  water, hang, shh, catchKeys, match, fold, feed, spot, count, catDash,
]

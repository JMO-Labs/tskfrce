/** Hungry Cat: sprite management and effects. */
import type { Application, Container, Sprite } from 'pixi.js'

export interface Assets {
  cat: any
  fish: any
  fried_shrimp: any
  cookie: any
  socks: any
  sparkles: any
}

export async function loadAssets(): Promise<Assets> {
  const P = await import('pixi.js')
  const f = (n: string) => `/files/fluent/${n}_3d.png`
  const names = ['cat', 'fish', 'fried_shrimp', 'cookie', 'socks', 'sparkles'] as const
  const loaded = await Promise.all(names.map((n) => P.Assets.load(f(n))))
  return Object.fromEntries(names.map((n, i) => [n, loaded[i]])) as Assets
}

export interface SpriteItem {
  sprite: Sprite
  vx: number
  vy: number
  life: number
}

export function burst(
  x: number,
  y: number,
  txt: string,
  col: number,
  world: Container,
  assets: Assets,
  still: boolean,
  fxList: SpriteItem[],
): void {
  const P = require('pixi.js') as typeof import('pixi.js')

  // sparkle particles
  if (!still) {
    for (let i = 0; i < 7; i++) {
      const p = new P.Sprite(assets.sparkles)
      p.anchor.set(0.5)
      p.width = p.height = 18
      p.x = x
      p.y = y
      const a = Math.random() * 6.28
      const vx = Math.cos(a) * 3
      const vy = Math.sin(a) * 3 - 2
      world.addChild(p)
      fxList.push({ sprite: p, vx, vy, life: 30 })
    }
  }

  // floating text
  const t = new P.Text({
    text: txt,
    style: {
      fontFamily: 'Space Grotesk',
      fontWeight: '700',
      fontSize: 26,
      fill: col,
      stroke: { color: 0x1d2b53, width: 4 },
    },
  })
  t.anchor.set(0.5)
  t.x = x
  t.y = y - 20
  world.addChild(t)
  fxList.push({ sprite: t as any, vx: 0, vy: -1.2, life: 40 })
}

export function updateFx(
  fxList: SpriteItem[],
  world: Container,
  dt: number,
  still: boolean,
): void {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const fx = fxList[i]
    const s = fx.sprite
    s.x += fx.vx * dt
    s.y += fx.vy * dt

    // gravity for sparkles
    if ((s as any).texture && (s as any).texture.label === 'sparkles') {
      fx.vy += 0.15 * dt
    }

    s.alpha = fx.life / 40
    fx.life -= dt

    if (fx.life <= 0) {
      world.removeChild(s)
      fxList.splice(i, 1)
    }
  }
}

export function applyShake(world: Container, shake: number): void {
  if (shake > 0) {
    world.x = (Math.random() - 0.5) * shake
    world.y = (Math.random() - 0.5) * shake
  } else {
    world.x = world.y = 0
  }
}

export function mkCat(
  x: number,
  y: number,
  assets: Assets,
  world: Container,
): { body: Sprite; container: Container } {
  const P = require('pixi.js') as typeof import('pixi.js')
  const c = new P.Container()
  const s = new P.Sprite(assets.cat)
  s.anchor.set(0.5, 1)
  s.width = s.height = 84

  const bowl = new P.Graphics()
    .roundRect(-34, -6, 68, 26, 12)
    .fill(0xff6b4a)
    .stroke({ width: 3, color: 0x1d2b53 })
    .ellipse(0, -6, 34, 7)
    .fill(0xffd2c4)
    .stroke({ width: 3, color: 0x1d2b53 })
  bowl.y = -8
  bowl.x = 34

  c.addChild(s, bowl)
  c.x = x
  c.y = y
  world.addChild(c)
  return { body: s, container: c }
}

export function mkFood(
  x: number,
  y: number,
  kind: 'fish' | 'fried_shrimp' | 'cookie' | 'socks',
  assets: Assets,
  world: Container,
): Sprite {
  const P = require('pixi.js') as typeof import('pixi.js')
  const s = new P.Sprite(assets[kind])
  s.anchor.set(0.5)
  s.width = s.height = kind === 'socks' ? 50 : 46
  s.x = x
  s.y = y
  world.addChild(s)
  return s
}

import { aliasQuery, useFocusAliases } from '@/v2/parent/focusAliases'
import { fakeRouter } from './helpers/fakeRouter'
import { createElement } from 'react'
import { render } from '@testing-library/react'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

const Harness = () => { useFocusAliases(); return null }

test.each([
  ['/', { tab: 'needs' }, '', undefined, { focus: 'needs' }],
  ['/', { item: '5' }, '', undefined, { kid: '5' }],
  ['/', { chore: '12' }, '', (r: number) => (r === 12 ? 3 : undefined), { kid: '3', chore: '12' }],
  ['/', { chore: '12' }, '', undefined, null],
  ['/kids', { kid: '7', section: 'chores' }, '', undefined, { section: 'chores', item: 'new' }],
  ['/kids', { kid: '7', section: 'kids' }, '', undefined, { section: 'kids', item: '7' }],
  ['/kids', { kid: '7' }, '', undefined, { section: 'kids', item: '7' }],
  ['/kids', { kid: '7', section: 'kids', pin: '1' }, '', undefined, { section: 'kids', item: '7', open: 'settings', edit: '1', pin: '1' }],
  ['/kids', { kid: '7' }, '#trust', undefined, { section: 'kids', item: '7', open: 'trust' }],
  ['/kids', { section: 'kids', kid: '7' }, '#trust', undefined, { section: 'kids', item: '7', open: 'trust' }],
  ['/kids', { section: 'kids', item: '7' }, '#trust', undefined, { section: 'kids', item: '7', open: 'trust' }],
  ['/kids', { section: 'kids', item: '7', open: 'basics' }, '#trust', undefined, null],
  ['/kids', { section: 'kids', item: '7' }, '', undefined, null],
] as const)('aliasQuery %s %j %s', (path, q, hash, fn, want) => {
  expect(aliasQuery(path, q, hash, fn)).toEqual(want)
})

test('alias rewrite uses replace', () => {
  fakeRouter.reset('/', { tab: 'needs' })
  render(createElement(Harness))
  expect(fakeRouter.replace).toHaveBeenCalledWith({ pathname: '/', query: { focus: 'needs' } }, undefined, { shallow: true, scroll: false })
  expect(fakeRouter.push).not.toHaveBeenCalled()
})
test('a chore not on today goes to Needs you', () => expect(aliasQuery('/', { chore: '77' }, '', () => undefined)).toEqual({ focus: 'needs' }))
test('waits for data before mapping a chore', () => expect(aliasQuery('/', { chore: '77' }, '')).toBeNull())
test('already-new links are left alone', () => expect(aliasQuery('/', { kid: '3', chore: '12' }, '')).toBeNull())

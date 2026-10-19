import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyAutoArchive,
  DecodeError,
  decodeAppData,
  dueCategory,
  encodeJSON,
  filterMatches,
  isoDate,
  isSafeFileName,
  makeBoard,
  makeCard,
  placeOrphanedCards,
  reidentifyBoard,
  type AppData
} from '../src/shared/model.ts'

test('dates are written without milliseconds, as the Mac app expects', () => {
  assert.match(isoDate(new Date('2026-10-09T06:27:11.456Z')), /^2026-10-09T06:27:11Z$/)
})

test('missing or wrong scalar fields fall back to defaults', () => {
  const data = decodeAppData({ boards: [{ name: 'B', columns: [{ name: 'c' }], cards: [{ title: 't', futureField: 1, isDone: 'yes' }] }] })
  assert.equal(data.schemaVersion, 1)
  assert.equal(data.boards[0].cards[0].isDone, false)
  assert.equal(data.boards[0].labels.length, 6, 'old boards get six default labels')
})

test('broken arrays or a missing boards key fail loudly instead of losing data', () => {
  assert.throws(() => decodeAppData({ selectedBoardID: null }), DecodeError)
  assert.throws(() => decodeAppData({ boards: [{ name: 'B', cards: [{ title: 't', attachments: [{ originalName: 'x' }] }] }] }), DecodeError)
})

test('encoded JSON has sorted keys and omits empty optionals', () => {
  const card = makeCard({ title: 'x' })
  const json = encodeJSON(card)
  const keys = Object.keys(JSON.parse(json))
  assert.deepEqual(keys, [...keys].sort())
  assert.ok(!json.includes('dueDate'))
})

test('filters and due-date groups behave like the Mac app', () => {
  const now = new Date(2026, 9, 10, 12, 0, 0)
  const card = (hoursFromNow: number | undefined, extra = {}) =>
    makeCard({ title: 'c', ...(hoursFromNow === undefined ? {} : { dueDate: isoDate(new Date(now.getTime() + hoursFromNow * 3600e3)) }), ...extra })
  const overdue = card(-30), earlierToday = card(-1), laterToday = card(1), in3days = card(72), in10days = card(240), none = card(undefined)
  const f = (due: 'overdue' | 'today' | 'week' | 'none') => ({ labelIDs: [], status: 'all' as const, due })
  assert.ok(filterMatches(f('overdue'), overdue, now) && filterMatches(f('overdue'), earlierToday, now) && !filterMatches(f('overdue'), laterToday, now))
  assert.ok(filterMatches(f('today'), earlierToday, now) && !filterMatches(f('today'), overdue, now))
  assert.ok(filterMatches(f('week'), in3days, now) && !filterMatches(f('week'), in10days, now))
  assert.ok(filterMatches(f('none'), none, now) && !filterMatches(f('none'), in3days, now))
  assert.equal(dueCategory(new Date(now.getTime() + 72 * 3600e3), now), 'thisWeek')
  assert.equal(dueCategory(new Date(now.getTime() + 240 * 3600e3), now), 'later')
})

test('auto-archive archives old done cards and starts the timer for undated ones', () => {
  const now = new Date('2026-10-10T12:00:00Z')
  const board = { ...makeBoard('b', ['a', 'b', 'c']), autoArchiveDays: 3 }
  const col = board.columns[0].id
  board.cards = [
    makeCard({ title: 'old', columnID: col, isDone: true, completedAt: isoDate(new Date(now.getTime() - 4 * 86400e3)) }),
    makeCard({ title: 'recent', columnID: col, isDone: true, completedAt: isoDate(new Date(now.getTime() - 86400e3)) }),
    makeCard({ title: 'undated', columnID: col, isDone: true }),
    makeCard({ title: 'open', columnID: col })
  ]
  const data: AppData = { schemaVersion: 4, boards: [board] }
  const result = applyAutoArchive(data, now)
  const [old, recent, undated, open] = result.boards[0].cards
  assert.ok(old.isArchived && !recent.isArchived && !undated.isArchived && !open.isArchived)
  assert.equal(undated.completedAt, isoDate(now))
  assert.equal(applyAutoArchive(result, now), result, 'second run changes nothing')
})

test('re-identified boards get fresh IDs and keep their links', () => {
  const board = makeBoard('b', ['a', 'b', 'c'])
  board.cards = [makeCard({ title: 'x', columnID: board.columns[1].id, labelIDs: [board.labels[0].id], checklist: [{ id: 'i', text: 't', isDone: false }], attachments: [{ id: 'a', fileName: 'f.png', originalName: 'f.png' }] })]
  const copy = reidentifyBoard(board, (a) => ({ ...a, fileName: 'new.png' }))
  assert.notEqual(copy.id, board.id)
  assert.equal(copy.cards[0].columnID, copy.columns[1].id)
  assert.deepEqual(copy.cards[0].labelIDs, [copy.labels[0].id])
  assert.equal(copy.cards[0].attachments[0].fileName, 'new.png')
  assert.notEqual(copy.cards[0].checklist[0].id, 'i')
})

test('orphaned cards are placed into the first list', () => {
  const board = makeBoard('b', ['a', 'b', 'c'])
  board.cards = [makeCard({ title: 'x' })]
  assert.equal(placeOrphanedCards(board, 'To Do').cards[0].columnID, board.columns[0].id)
})

test('attachment names must be plain file names', () => {
  for (const bad of ['', '.', '..', '../x', 'a/b', 'a\\b', '.hidden']) assert.equal(isSafeFileName(bad), false, bad)
  assert.ok(isSafeFileName('ABC.png'))
})

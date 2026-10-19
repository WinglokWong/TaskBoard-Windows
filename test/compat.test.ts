// 与 macOS 版的兼容性：读取由 macOS 版自己的代码（Swift）生成的数据文件和 .taskboard 文件
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { decodeAppData, encodeJSON, labelsOf } from '../src/shared/model.ts'
import { readArchive } from '../src/main/archive.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url))

test('reads data.json written by the Mac app, every field intact', () => {
  const data = decodeAppData(JSON.parse(fixture('mac-data.json').toString('utf8')))
  const board = data.boards[0]
  assert.equal(data.selectedBoardID, '00000000-0000-4000-8000-000000000001')
  assert.equal(board.name, 'Mac 看板')
  assert.equal(board.autoArchiveDays, 7)
  assert.equal(board.columns[1].color?.a, 0.8)
  assert.equal(board.labels.length, 2)
  const card = board.cards[0]
  assert.equal(card.title, '完整的卡片')
  assert.equal(card.dueDate, '2026-10-09T06:27:11Z')
  assert.equal(card.reminderMinutes, 15)
  assert.equal(card.completedAt, '2026-10-09T06:27:11Z')
  assert.deepEqual(labelsOf(board, card).map((l) => l.name), ['工作', ''])
  assert.deepEqual(card.checklist.map((i) => [i.text, i.isDone]), [['第一项', true], ['第二项', false]])
  assert.equal(card.attachments[0].originalName, '截图.png')
  assert.equal(board.cards[1].isArchived, true)
})

test('writing the Mac data back produces the same JSON (round trip)', () => {
  const raw = fixture('mac-data.json').toString('utf8')
  const data = decodeAppData(JSON.parse(raw))
  // macOS 写的 JSON 冒号前有空格（"key" : value），比较时按 JSON 结构比较
  assert.deepEqual(JSON.parse(encodeJSON(data)), JSON.parse(raw))
})

test('imports a board exported by the Mac app, with its attachment', () => {
  const archive = readArchive(new Uint8Array(fixture('mac-board.taskboard')))
  assert.equal(archive.manifest.kind, 'board')
  assert.equal(archive.boards[0].name, 'Mac 看板')
  assert.equal(archive.boards[0].cards.length, 3)
  assert.deepEqual([...archive.attachments.get('A1.png')!], [0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
})

test('imports all data exported by the Mac app', () => {
  const archive = readArchive(new Uint8Array(fixture('mac-library.taskboard')))
  assert.equal(archive.manifest.kind, 'library')
  assert.equal(archive.library?.selectedBoardID, '00000000-0000-4000-8000-000000000001')
  assert.equal(archive.boards.length, 1)
})

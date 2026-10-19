import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { ArchiveError, createArchive, readArchive } from '../src/main/archive.ts'
import { decodeAppData, makeBoard, makeCard, newID } from '../src/shared/model.ts'

const manifest = (extra = {}) => strToU8(JSON.stringify({ format: 'taskboard', formatVersion: 1, kind: 'board', appVersion: 'x', exportedAt: '2026-10-10T00:00:00Z', ...extra }))

function expectError(bytes: Uint8Array, code: string) {
  assert.throws(() => readArchive(bytes), (e: unknown) => e instanceof ArchiveError && e.code === code)
}

test('board export round-trips with attachments', () => {
  const board = makeBoard('b', ['a', 'b', 'c'])
  board.cards = [makeCard({ title: 'x', columnID: board.columns[0].id, attachments: [{ id: newID(), fileName: 'f.png', originalName: 'f.png' }] })]
  const bytes = createArchive('board', board, [['f.png', new Uint8Array([1, 2, 3])]], '1.0.0')
  const archive = readArchive(bytes)
  assert.equal(archive.manifest.kind, 'board')
  assert.deepEqual(archive.boards[0], decodeAppData({ boards: [board] }).boards[0])
  assert.deepEqual([...archive.attachments.get('f.png')!], [1, 2, 3])
})

test('hostile or invalid files are rejected', () => {
  expectError(zipSync({ 'manifest.json': manifest(), 'data.json': strToU8('{}'), '../escaped.txt': strToU8('x') }), 'unsafeContents')
  expectError(zipSync({ 'manifest.json': manifest(), 'data.json': strToU8('{}'), 'C:/evil.txt': strToU8('x') }), 'unsafeContents')
  expectError(strToU8('not a zip'), 'notAnArchive')
  expectError(zipSync({ 'readme.txt': strToU8('x') }), 'notAnArchive')
  expectError(zipSync({ 'manifest.json': manifest({ formatVersion: 2 }), 'data.json': strToU8('{}') }), 'unsupportedVersion')
  expectError(zipSync({ 'manifest.json': manifest(), 'data.json': strToU8('not json') }), 'damaged')
  expectError(zipSync({ 'manifest.json': manifest({ format: 'other' }), 'data.json': strToU8('{}') }), 'notAnArchive')
})

test('attachments with unsafe names inside the zip are ignored', () => {
  const board = makeBoard('b', ['a', 'b', 'c'])
  const bytes = zipSync({ 'manifest.json': manifest(), 'data.json': strToU8(JSON.stringify(board)), attachments: { '.hidden': strToU8('x'), 'ok.png': strToU8('y') } })
  const archive = readArchive(bytes)
  assert.deepEqual([...archive.attachments.keys()], ['ok.png'])
})

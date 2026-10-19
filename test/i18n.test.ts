import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectLanguage, format, setLanguage, t } from '../src/shared/i18n/index.ts'

test('Mac-style placeholders, including numbered ones', () => {
  assert.equal(format('%@ · %@', ['a', 'b']), 'a · b')
  assert.equal(format('From “%1$@” · archived %2$@', ['X', 'Y']), 'From “X” · archived Y')
  assert.equal(format('%lld/%lld', [3, 5]), '3/5')
})

test('translations and English plurals', () => {
  setLanguage('en')
  assert.equal(t('待办'), 'To Do')
  assert.equal(t('已开启自动归档：完成 %lld 天后', 1), 'Auto-archive on: 1 day after done')
  assert.equal(t('已开启自动归档：完成 %lld 天后', 3), 'Auto-archive on: 3 days after done')
  setLanguage('zh-Hant')
  assert.equal(t('待办'), '待辦')
  setLanguage('zh-Hans')
  assert.equal(t('待办'), '待办')
})

test('language detection from system preferences', () => {
  assert.equal(detectLanguage(['zh-Hans-CN']), 'zh-Hans')
  assert.equal(detectLanguage(['zh-TW']), 'zh-Hant')
  assert.equal(detectLanguage(['zh-Hant-HK']), 'zh-Hant')
  assert.equal(detectLanguage(['fr-FR', 'en-US']), 'en')
  assert.equal(detectLanguage(['ja-JP']), 'en')
})

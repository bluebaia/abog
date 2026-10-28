import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { syncBlogAssets } from './sync-blog-assets.mjs'

test('copies canonical assets into the active public directory and removes stale copies', t => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'blog-assets-sync-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  const sourceRoot = path.join(projectRoot, '.blog/assets')
  const destinationRoot = path.join(projectRoot, 'blog/public/assets')
  mkdirSync(path.join(sourceRoot, 'articles'), { recursive: true })
  mkdirSync(path.join(destinationRoot, 'old'), { recursive: true })
  writeFileSync(path.join(sourceRoot, 'articles/cover.png'), 'image bytes')
  writeFileSync(path.join(sourceRoot, '.gitkeep'), '')
  writeFileSync(path.join(sourceRoot, '.DS_Store'), 'local metadata')
  writeFileSync(path.join(destinationRoot, 'old/stale.png'), 'stale')

  assert.equal(syncBlogAssets(projectRoot), 1)
  assert.equal(readFileSync(path.join(destinationRoot, 'articles/cover.png'), 'utf8'), 'image bytes')
  assert.equal(existsSync(path.join(destinationRoot, 'old/stale.png')), false)
})

test('rejects asset names that cannot be checked out on Windows', t => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'blog-assets-name-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  const sourceRoot = path.join(projectRoot, '.blog/assets')
  mkdirSync(sourceRoot, { recursive: true })
  writeFileSync(path.join(sourceRoot, 'CON.png'), 'image bytes')

  assert.throws(() => syncBlogAssets(projectRoot), /not safe to check out/)
})

test('rejects paths that collide on common case-insensitive file systems', t => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'blog-assets-case-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  const sourceRoot = path.join(projectRoot, '.blog/assets')
  mkdirSync(sourceRoot, { recursive: true })
  writeFileSync(path.join(sourceRoot, 'Cover.png'), 'one')
  writeFileSync(path.join(sourceRoot, 'cover.png'), 'two')

  assert.throws(() => syncBlogAssets(projectRoot), /collide on a supported file system/)
})

test('rejects asset symlinks without replacing the current public directory', t => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'blog-assets-link-'))
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }))
  const sourceRoot = path.join(projectRoot, '.blog/assets')
  const destinationRoot = path.join(projectRoot, 'blog/public/assets')
  mkdirSync(sourceRoot, { recursive: true })
  mkdirSync(destinationRoot, { recursive: true })
  writeFileSync(path.join(destinationRoot, 'existing.png'), 'existing')
  writeFileSync(path.join(projectRoot, 'outside.png'), 'outside')
  try {
    symlinkSync(path.join(projectRoot, 'outside.png'), path.join(sourceRoot, 'linked.png'))
  } catch {
    t.skip('file symlinks are unavailable in this environment')
    return
  }

  assert.throws(() => syncBlogAssets(projectRoot), /symlinks are not supported/)
  assert.equal(readFileSync(path.join(destinationRoot, 'existing.png'), 'utf8'), 'existing')
})

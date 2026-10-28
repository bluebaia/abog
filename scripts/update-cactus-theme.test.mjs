import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { recordCurrentCactusRelease, updateCactusThemeFromSource } from './update-cactus-theme.mjs'

const repository = 'https://github.com/chrismwilliams/astro-theme-cactus.git'

function git(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
}

function digest(contents) {
  return createHash('sha256').update(contents).digest('hex')
}

function json(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function createRepo(directory) {
  mkdirSync(directory, { recursive: true })
  git(directory, ['init', '--quiet', '--initial-branch=main'])
  git(directory, ['config', 'user.name', 'Theme Test'])
  git(directory, ['config', 'user.email', 'theme-test@example.test'])
}

test('proposes and records a Cactus release only after site validation', t => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'blog-cactus-update-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))
  const destination = path.join(temporaryRoot, 'template')
  const source = path.join(temporaryRoot, 'source')
  createRepo(destination)
  createRepo(source)

  const oldLicense = 'Cactus license at current source\n'
  const newLicense = 'Cactus license at candidate source\n'
  const adapterFile = 'export const deploymentBase = "/journal";\n'
  mkdirSync(path.join(destination, 'blog'), { recursive: true })
  mkdirSync(path.join(destination, 'blog/src/utils'), { recursive: true })
  mkdirSync(path.join(destination, '.template'), { recursive: true })
  writeFileSync(path.join(destination, 'blog/LICENSE'), oldLicense)
  writeFileSync(path.join(destination, 'blog/src/utils/blog-template.ts'), adapterFile)
  json(path.join(destination, '.template/theme-source.json'), {
    formatVersion: 1,
    theme: 'astro-cactus',
    repository,
    ref: 'v8.3.0',
    commit: 'a'.repeat(40),
    files: { LICENSE: digest(Buffer.from(oldLicense)) },
    adapterFiles: { 'src/utils/blog-template.ts': digest(Buffer.from(adapterFile)) },
  })
  json(path.join(destination, '.template/cactus-compatibility.json'), {
    formatVersion: 1,
    theme: 'astro-cactus',
    repository,
    verifiedReleases: [{ ref: 'v8.3.0', commit: 'a'.repeat(40) }],
  })
  json(path.join(destination, '.template/theme-catalog.json'), {
    schemaVersion: 1,
    themes: { 'astro-cactus': { id: 'astro-cactus', repository, ref: 'v8.3.0', commit: 'a'.repeat(40) } },
  })
  git(destination, ['add', '--all'])
  git(destination, ['commit', '--quiet', '-m', 'current theme'])

  writeFileSync(path.join(source, 'LICENSE'), newLicense)
  git(source, ['add', 'LICENSE'])
  git(source, ['commit', '--quiet', '-m', 'candidate release'])
  git(source, ['remote', 'add', 'origin', repository])
  const candidateCommit = git(source, ['rev-parse', 'HEAD'])

  assert.equal(updateCactusThemeFromSource({ destination, source, sourceRef: 'v8.4.0' }), false)
  assert.equal(git(destination, ['status', '--porcelain']), '')
  assert.equal(updateCactusThemeFromSource({ destination, source, sourceRef: 'v8.4.0', proposeRelease: true }), true)
  assert.equal(readFileSync(path.join(destination, 'blog/LICENSE'), 'utf8'), newLicense)
  assert.equal(readFileSync(path.join(destination, 'blog/src/utils/blog-template.ts'), 'utf8'), adapterFile)
  assert.deepEqual(JSON.parse(readFileSync(path.join(destination, '.template/cactus-compatibility.json'), 'utf8')).verifiedReleases, [
    { ref: 'v8.3.0', commit: 'a'.repeat(40) },
  ])

  assert.equal(recordCurrentCactusRelease(destination), true)
  const compatibility = JSON.parse(readFileSync(path.join(destination, '.template/cactus-compatibility.json'), 'utf8'))
  const catalog = JSON.parse(readFileSync(path.join(destination, '.template/theme-catalog.json'), 'utf8'))
  assert.deepEqual(compatibility.verifiedReleases.at(-1), { ref: 'v8.4.0', commit: candidateCommit })
  assert.equal(catalog.themes['astro-cactus'].ref, 'v8.4.0')
  assert.equal(catalog.themes['astro-cactus'].commit, candidateCommit)
  assert.equal(recordCurrentCactusRelease(destination), false)
})

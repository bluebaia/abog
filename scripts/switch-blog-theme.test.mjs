import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { switchBlogTheme } from './switch-blog-theme.mjs'

const cactusRepository = 'https://github.com/chrismwilliams/astro-theme-cactus.git'

function git(directory, args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function writeJson(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function configuration() {
  return {
    schemaVersion: 1,
    repository: { owner: 'writer', name: 'journal', defaultBranch: 'main' },
    writing: { noteLabel: 'Note', blogLabel: 'Blog', noteContainerTitle: 'Notes' },
    theme: { id: 'astro-paper', options: { 'astro-paper': {}, 'astro-cactus': {} } },
    site: {
      url: 'https://writer.github.io/journal/',
      title: 'A public journal',
      description: 'Short public writing.',
      author: 'Writer',
      ogImage: 'default-og.jpg',
      lang: 'en',
      timezone: 'UTC',
      dir: 'ltr',
    },
    home: {
      title: 'A public journal',
      description: 'Welcome to this journal.',
      readmeUrl: 'https://github.com/writer/journal',
    },
    posts: { perPage: 10, perIndex: 10, scheduledPostMargin: 900000 },
    features: {
      lightAndDarkMode: true,
      dynamicOgImage: true,
      showArchives: true,
      showBackButton: true,
      editPost: { enabled: false },
      search: 'pagefind',
    },
    socials: [],
    shareLinks: [{ name: 'mail', url: 'mailto:?subject=Hello&body=' }],
  }
}

function createRepository(directory) {
  mkdirSync(directory, { recursive: true })
  git(directory, ['init', '--quiet', '--initial-branch=main'])
  git(directory, ['config', 'user.name', 'Template Test'])
  git(directory, ['config', 'user.email', 'template-test@example.test'])
}

test('switches from the pinned active theme, preserves canonical settings, and is retry-safe', async t => {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'blog-theme-switch-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))
  const projectRoot = path.join(temporaryRoot, 'project')
  const source = path.join(temporaryRoot, 'cactus')
  createRepository(projectRoot)
  createRepository(source)

  const oldLicense = 'AstroPaper license\n'
  const newLicense = 'Astro Cactus license\n'
  mkdirSync(path.join(projectRoot, 'blog'), { recursive: true })
  mkdirSync(path.join(projectRoot, '.blog'), { recursive: true })
  writeFileSync(path.join(projectRoot, 'blog/LICENSE'), oldLicense)
  const oldAdapter = 'export default "AstroPaper adapter"\n'
  writeFileSync(path.join(projectRoot, 'blog/astro-paper.config.ts'), oldAdapter)
  const current = configuration()
  writeJson(path.join(projectRoot, '.blog/config.json'), current)

  writeFileSync(path.join(source, 'LICENSE'), newLicense)
  git(source, ['add', 'LICENSE'])
  git(source, ['commit', '--quiet', '-m', 'theme source'])
  git(source, ['remote', 'add', 'origin', cactusRepository])
  const cactusCommit = git(source, ['rev-parse', 'HEAD'])

  const paperRepository = 'https://github.com/satnaing/astro-paper.git'
  const paperCommit = 'a'.repeat(40)
  writeJson(path.join(projectRoot, '.template/theme-catalog.json'), {
    schemaVersion: 1,
    themes: {
      'astro-paper': {
        id: 'astro-paper',
        repository: paperRepository,
        ref: 'v1.0.0',
        commit: paperCommit,
        fileManifest: 'scripts/theme-files/astro-paper.json',
        adapterVersion: 1,
      },
      'astro-cactus': {
        id: 'astro-cactus',
        repository: cactusRepository,
        ref: 'v8.3.0',
        commit: cactusCommit,
        fileManifest: 'scripts/theme-files/astro-cactus.json',
        adapterVersion: 1,
      },
    },
  })
  writeJson(path.join(projectRoot, '.template/theme-source.json'), {
    formatVersion: 1,
    theme: 'astro-paper',
    repository: paperRepository,
    ref: 'v1.0.0',
    commit: paperCommit,
    files: { LICENSE: digest(oldLicense) },
    adapterFiles: { 'astro-paper.config.ts': digest(oldAdapter) },
  })
  writeJson(path.join(projectRoot, 'scripts/theme-files/astro-cactus.json'), ['LICENSE'])
  git(projectRoot, ['add', '--all'])
  git(projectRoot, ['commit', '--quiet', '-m', 'initial template'])

  assert.equal(await switchBlogTheme({ projectRoot, themeId: 'astro-cactus', sourceDirectory: source }), true)
  assert.equal(readFileSync(path.join(projectRoot, 'blog/LICENSE'), 'utf8'), newLicense)
  assert.equal(readFileSync(path.join(projectRoot, '.blog/config.json'), 'utf8').includes('"id": "astro-cactus"'), true)
  assert.equal(existsSync(path.join(projectRoot, 'blog/astro-paper.config.ts')), false)
  assert.equal(readFileSync(path.join(projectRoot, 'blog/src/utils/blog-template.ts'), 'utf8').includes('deploymentBase'), true)
  assert.equal(JSON.parse(readFileSync(path.join(projectRoot, '.template/theme-source.json'), 'utf8')).theme, 'astro-cactus')
  assert.equal(await switchBlogTheme({ projectRoot, themeId: 'astro-cactus', sourceDirectory: source }), false)

  writeFileSync(path.join(projectRoot, 'blog/LICENSE'), 'local theme change\n')
  await assert.rejects(
    switchBlogTheme({ projectRoot, themeId: 'astro-paper', sourceDirectory: source }),
    /differ from their recorded source/,
  )
  assert.equal(JSON.parse(readFileSync(path.join(projectRoot, '.blog/config.json'), 'utf8')).theme.id, 'astro-cactus')
})

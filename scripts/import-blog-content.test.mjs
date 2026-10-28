import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { applyBlogImport, createBlogImportPlan } from './import-blog-content.mjs'

function createFixture() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'blog-import-'))
  const sourceRoot = path.join(directory, 'source')
  const projectRoot = path.join(directory, 'target')
  const contentDirectory = path.join(sourceRoot, 'src/content/blog')
  mkdirSync(contentDirectory, { recursive: true })
  mkdirSync(path.join(projectRoot, '.blog'), { recursive: true })
  writeFileSync(path.join(projectRoot, '.blog/config.json'), JSON.stringify({ site: { author: 'Reader', timezone: 'UTC' } }))
  const postPath = path.join(contentDirectory, '2023-05-01-hello-world.md')
  writeFileSync(postPath, [
    '---',
    'title: "Hello world"',
    'description: "A migrated article."',
    'pubDatetime: 2023-05-01T10:00:00Z',
    'modDatetime: 2023-05-02T10:00:00Z',
    'slug: hello-world',
    'author: Sam',
    'tags:',
    '  - writing',
    '  - migration',
    'featured: true',
    'heroImage: ./cover.png',
    'customThemeField: amber',
    '---',
    '',
    '![Cover](./cover.png)',
    '',
  ].join('\n'))
  writeFileSync(path.join(contentDirectory, 'cover.png'), 'cover bytes')
  return { directory, sourceRoot, projectRoot, postPath }
}

test('previews and explicitly imports supported posts and their local image assets once', t => {
  const fixture = createFixture()
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }))

  const plan = createBlogImportPlan({ sourceRoot: fixture.sourceRoot, projectRoot: fixture.projectRoot })
  assert.equal(plan.canApply, true)
  assert.equal(plan.posts.length, 1)
  assert.equal(plan.posts[0].slug, 'hello-world')
  assert.deepEqual(plan.posts[0].tags, ['writing', 'migration'])
  assert.equal(plan.assets.length, 1)
  assert.equal(plan.unsupported.some(item => item.field === 'customThemeField'), true)

  const applied = applyBlogImport({
    sourceRoot: fixture.sourceRoot,
    projectRoot: fixture.projectRoot,
    expectedPlanSha256: plan.planSha256,
  })
  assert.equal(applied.importedPosts, 1)
  const articlePath = path.join(fixture.projectRoot, plan.posts[0].destinationPath)
  const article = readFileSync(articlePath, 'utf8')
  assert.match(article, /identity: \{"kind":"imported","id":"[0-9a-f]+"\}/)
  assert.match(article, /slug: "hello-world"/)
  assert.match(article, /ogImage: "\.\.\/\.\.\/assets\/imported\//)
  assert.match(article, /!\[Cover\]\(\.\.\/\.\.\/assets\/imported\//)
  assert.equal(readFileSync(path.join(fixture.projectRoot, plan.assets[0].destinationPath), 'utf8'), 'cover bytes')
  assert.equal(existsSync(path.join(fixture.projectRoot, '.blog/imports/receipt.json')), true)

  const repeatedPlan = createBlogImportPlan({ sourceRoot: fixture.sourceRoot, projectRoot: fixture.projectRoot })
  assert.equal(repeatedPlan.canApply, false)
  assert.match(repeatedPlan.conflicts.join('\n'), /already imported/)
})

test('refuses to apply a preview after source content changes', t => {
  const fixture = createFixture()
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }))
  const plan = createBlogImportPlan({ sourceRoot: fixture.sourceRoot, projectRoot: fixture.projectRoot })
  writeFileSync(fixture.postPath, readFileSync(fixture.postPath, 'utf8') + '\nChanged after review.\n')

  assert.throws(
    () => applyBlogImport({
      sourceRoot: fixture.sourceRoot,
      projectRoot: fixture.projectRoot,
      expectedPlanSha256: plan.planSha256,
    }),
    /changed since preview/,
  )
  assert.equal(existsSync(path.join(fixture.projectRoot, '.blog/imports/receipt.json')), false)
})

test('reports drafts and blocks content that lacks a usable publication date', t => {
  const fixture = createFixture()
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }))
  writeFileSync(path.join(fixture.sourceRoot, 'src/content/blog/draft.md'), [
    '---',
    'title: Draft',
    'draft: true',
    '---',
    'Not imported.',
  ].join('\n'))
  writeFileSync(path.join(fixture.sourceRoot, 'src/content/blog/undated.md'), [
    '---',
    'title: Undated',
    '---',
    'Needs a date.',
  ].join('\n'))

  const plan = createBlogImportPlan({ sourceRoot: fixture.sourceRoot, projectRoot: fixture.projectRoot })
  assert.equal(plan.skipped.some(item => /draft/i.test(item.reason)), true)
  assert.equal(plan.canApply, false)
  assert.equal(plan.unsupported.some(item => item.blocking && /publication date/i.test(item.message)), true)
})

test('recognizes Cactus posts, notes, nested cover metadata, and pinned articles', t => {
  const fixture = createFixture()
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }))
  rmSync(path.join(fixture.sourceRoot, 'src/content/blog'), { recursive: true })
  const posts = path.join(fixture.sourceRoot, 'content/posts')
  const notes = path.join(fixture.sourceRoot, 'content/notes')
  mkdirSync(posts, { recursive: true })
  mkdirSync(notes, { recursive: true })
  writeFileSync(path.join(posts, 'essay.md'), [
    '---',
    'title: "A Cactus essay"',
    'description: "Migrated from Cactus."',
    'publishDate: "04 July 2023"',
    'updatedDate: "14 August 2023"',
    'slug: cactus-essay',
    'pinned: true',
    'coverImage:',
    '  src: ./cover.jpg',
    '  alt: Essay cover',
    'tags: ["journal", "travel"]',
    '---',
    '',
    'Article body.',
  ].join('\n'))
  writeFileSync(path.join(posts, 'cover.jpg'), 'cactus cover')
  writeFileSync(path.join(notes, 'short-note.md'), [
    '---',
    'title: A short note',
    'description: A Cactus note.',
    'publishDate: "2024-10-14T11:23:00Z"',
    '---',
    '',
    'A note body.',
  ].join('\n'))

  const plan = createBlogImportPlan({ sourceRoot: fixture.sourceRoot, projectRoot: fixture.projectRoot })
  assert.equal(plan.posts.length, 2)
  const essay = plan.posts.find(post => post.slug === 'cactus-essay')
  assert.equal(essay.featured, true)
  assert.match(essay.ogImage, /^\.\.\/\.\.\/assets\/imported\//)
  assert.equal(plan.assets.length, 1)
})

test('excludes the original theme repository demo content', t => {
  const fixture = createFixture()
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }))

  const plan = createBlogImportPlan({
    sourceRoot: fixture.sourceRoot,
    projectRoot: fixture.projectRoot,
    sourceUrl: 'https://github.com/chrismwilliams/astro-theme-cactus',
  })
  assert.equal(plan.posts.length, 0)
  assert.equal(plan.skipped.some(item => /theme sample/i.test(item.reason)), true)
  assert.equal(plan.canApply, false)
})

test('rejects a source URL outside public GitHub repositories before cloning', t => {
  const fixture = createFixture()
  t.after(() => rmSync(fixture.directory, { recursive: true, force: true }))
  const scriptPath = fileURLToPath(new URL('./import-blog-content.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [
    scriptPath,
    '--source-url',
    'https://example.com/user/blog',
    '--preview',
    '--project-root',
    fixture.projectRoot,
  ], { encoding: 'utf8' })

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /public https:\/\/github\.com/)
})

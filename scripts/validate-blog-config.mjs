import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateBlogConfiguration } from './blog-config.mjs'

const configPath = fileURLToPath(new URL('../.blog/config.json', import.meta.url))

try {
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const contextValues = [
    process.env.BLOG_REPOSITORY_OWNER,
    process.env.BLOG_REPOSITORY_NAME,
    process.env.BLOG_DEFAULT_BRANCH,
  ]
  const repositoryContext = contextValues.some(value => value !== undefined)
    ? {
        owner: process.env.BLOG_REPOSITORY_OWNER,
        name: process.env.BLOG_REPOSITORY_NAME,
        defaultBranch: process.env.BLOG_DEFAULT_BRANCH,
      }
    : undefined
  const errors = validateBlogConfiguration(config, repositoryContext)
  if (errors.length) {
    process.stderr.write(`${errors.map(error => `${error.path}: ${error.message}`).join('\n')}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(
      `Blog configuration is valid (schema ${config.schemaVersion}, theme ${config.theme.id}, repository ${config.repository.owner}/${config.repository.name}).\n`,
    )
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
}

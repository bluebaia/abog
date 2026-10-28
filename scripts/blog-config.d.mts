export type BlogConfigValidationError = {
  path: string
  message: string
}

export type RepositoryContext = {
  owner: string
  name: string
  defaultBranch: string
}

type ResolvedThemeConfig = Omit<
  import('../blog/src/types/config').ResolvedAstroPaperConfig,
  'site'
> & {
  site: import('../blog/src/types/config').ResolvedAstroPaperConfig['site'] & {
    base: string
  }
  home: {
    title: string
    description: string
    readmeUrl: string
  }
}

export type ResolvedBlogConfiguration = {
  themeId: 'astro-paper' | 'astro-cactus'
  themeOptions: Record<string, Record<string, unknown>>
  repository: RepositoryContext
  writing: {
    noteLabel: string
    blogLabel: string
    noteContainerTitle: string
  }
  deployment: {
    site: string
    base: string
    locales: string[]
    defaultLocale: string
  }
  themeConfig: ResolvedThemeConfig
}

export function validateBlogConfiguration(
  config: unknown,
  repositoryContext?: RepositoryContext,
): BlogConfigValidationError[]
export function resolveBlogConfiguration(
  config: unknown,
  repositoryContext?: RepositoryContext,
): ResolvedBlogConfiguration

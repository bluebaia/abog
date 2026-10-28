const canonicalContentConfig = `import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

function removeDupsAndLowerCase(values: string[]) {
  return [...new Set(values.map((value) => value.toLowerCase()))];
}

const post = defineCollection({
  loader: glob({ base: "../.blog/content/posts", pattern: "*.{md,mdx}" }),
  schema: ({ image }) =>
    z.object({
      identity: z.object({
        kind: z.enum(["blog-issue", "note-comment", "imported"]),
        id: z.string().min(1),
      }),
      slug: z.string().min(1),
      author: z.string().min(1),
      title: z.string(),
      description: z.string(),
      pubDatetime: z.coerce.date(),
      modDatetime: z.coerce.date().optional(),
      timezone: z.string(),
      tags: z.array(z.string()).default([]).transform(removeDupsAndLowerCase),
      featured: z.boolean().default(false),
      ogImage: z.string().optional(),
      coverImage: z
        .object({ alt: z.string(), src: image() })
        .optional(),
    })
      .transform(({ pubDatetime, modDatetime, featured, ...post }) => ({
        ...post,
        publishDate: pubDatetime,
        updatedDate: modDatetime,
        pinned: featured,
        draft: false,
      })),
});

const note = defineCollection({
  loader: glob({ base: "./content/notes", pattern: "*.{md,mdx}" }),
  schema: z.object({ title: z.string(), description: z.string().optional(), publishDate: z.coerce.date() }),
});

const tag = defineCollection({
  loader: glob({ base: "./content/tags", pattern: "*.{md,mdx}" }),
  schema: z.object({ title: z.string().optional(), description: z.string().optional() }),
});

const pages = defineCollection({
  loader: glob({ base: "../.blog/content/pages", pattern: "*.{md,mdx}" }),
  schema: z.object({ title: z.string(), description: z.string().optional() }),
});

export const collections = { post, note, tag, pages };
`;

const canonicalSiteConfig = `import type { AstroExpressiveCodeOptions } from "astro-expressive-code";
import type { SiteConfig } from "@/types";
import blogConfiguration from "../../.blog/config.json";

export const siteConfig: SiteConfig = {
  url: blogConfiguration.site.url,
  title: blogConfiguration.site.title,
  author: blogConfiguration.site.author,
  description: blogConfiguration.site.description,
  lang: blogConfiguration.site.lang,
  ogLocale: blogConfiguration.site.lang.replaceAll("-", "_"),
  dir: blogConfiguration.site.dir,
  showLogo: true,
  date: {
    options: {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: blogConfiguration.site.timezone,
    },
  },
};

export const menuLinks = [
  { path: "/", title: "Home" },
  { path: "/about/", title: "About" },
  { path: "/posts/", title: "Blog" },
  { path: "/tags/", title: "Tags" },
];

type SocialLink = { name: string; url: string; linkTitle?: string };
export const siteSocialLinks = (blogConfiguration.socials as SocialLink[]).map((social) => ({
  friendlyName: social.linkTitle ?? social.name,
  link: social.url,
}));

export const homeConfig = blogConfiguration.home;
export const blogFeatures = blogConfiguration.features as { search: "pagefind" | false };

export const expressiveCodeOptions: AstroExpressiveCodeOptions = {
  styleOverrides: {
    borderRadius: "4px",
    codeFontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    codeFontSize: "0.875rem",
    codeLineHeight: "1.7142857rem",
    codePaddingInline: "1rem",
    frames: { frameBoxShadowCssValue: "none" },
    uiLineHeight: "inherit",
  },
  themeCssSelector(theme, { styleVariants }) {
    if (styleVariants.length >= 2) {
      const baseTheme = styleVariants[0]?.theme;
      const altTheme = styleVariants.find((variant) => variant.theme.type !== baseTheme?.type)?.theme;
      if (theme === baseTheme || theme === altTheme) return \`[data-theme='\${theme.type}']\`;
    }
    return \`[data-theme="\${theme.name}"]\`;
  },
  themes: ["dracula", "github-light"],
  useThemedScrollbars: false,
};
`;

const templateUrlHelpers = `import blogConfiguration from "../../../.blog/config.json";

export const siteOrigin = new URL(blogConfiguration.site.url).origin;
export const deploymentBase = new URL(blogConfiguration.site.url).pathname.replace(/\\/+$/, "") || "/";

export function withBase(pathname: string) {
  const path = pathname.startsWith("/") ? pathname : \`/\${pathname}\`;
  if (deploymentBase === "/") return path;
  if (path === deploymentBase || path.startsWith(\`\${deploymentBase}/\`)) return path;
  return \`\${deploymentBase}\${path}\`;
}

export function absoluteSiteUrl(pathname: string) {
  const target = new URL(pathname, siteOrigin);
  if (target.origin === siteOrigin) target.pathname = withBase(target.pathname);
  return target.href;
}
`;

function replaceOnce(source, pattern, replacement, file, description) {
  const matches = [...source.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))];
  if (matches.length !== 1) {
    throw new Error(`Cannot apply the Astro Cactus adapter to ${file}: expected one ${description} anchor.`);
  }
  return source.replace(pattern, replacement);
}

function replaceLiteralOnce(source, original, replacement, file, description) {
  const matches = source.split(original).length - 1;
  if (matches !== 1) {
    throw new Error(`Cannot apply the Astro Cactus adapter to ${file}: expected one ${description} anchor.`);
  }
  return source.replace(original, replacement);
}

function replaceLiteral(source, original, replacement) {
  return source.replaceAll(original, replacement);
}

function adaptAstroConfig(source) {
  let result = replaceOnce(
    source,
    /^import \{ expressiveCodeOptions, siteConfig \} from "\.\/src\/site\.config";$/m,
    'import { expressiveCodeOptions, siteConfig } from "./src/site.config";\nimport { deploymentBase } from "./src/utils/blog-template";',
    "astro.config.ts",
    "site configuration import",
  );
  result = replaceLiteralOnce(result, "\tsite: siteConfig.url,", "\tsite: new URL(siteConfig.url).origin,\n\tbase: deploymentBase,\n\ttrailingSlash: \"always\",", "astro.config.ts", "site and base path");
  return replaceLiteralOnce(result, "\t\t\tstart_url: \"/\",", "\t\t\tstart_url: deploymentBase ? `${deploymentBase}/` : \"/\",", "astro.config.ts", "manifest start URL");
}

function adaptBaseHead(source) {
  let result = replaceLiteralOnce(source, 'import { siteConfig } from "@/site.config";', 'import { siteConfig } from "@/site.config";\nimport { absoluteSiteUrl, withBase } from "@/utils/blog-template";', "src/components/BaseHead.astro", "URL helper import");
  result = replaceLiteralOnce(result, "const canonicalURL = new URL(Astro.url.pathname, Astro.site);", "const canonicalURL = absoluteSiteUrl(Astro.url.pathname);", "src/components/BaseHead.astro", "canonical URL");
  result = replaceLiteralOnce(result, 'const socialImageURL = new URL(ogImage ? ogImage : "/social-card.png", Astro.url).href;', 'const socialImageURL = absoluteSiteUrl(ogImage ?? "/social-card.png");', "src/components/BaseHead.astro", "social image URL");
  for (const file of ["/icon.svg", "/favicon-32x32.png", "/icons/apple-touch-icon.png", "/manifest.webmanifest", "/sitemap-index.xml", "/rss.xml"]) {
    result = replaceLiteral(result, `href="${file}"`, `href={withBase("${file}")}`);
  }
  return result.replace('<link href="/notes/rss.xml" title="Notes" rel="alternate" type="application/rss+xml" />', "");
}

function adaptHeader(source) {
  let result = replaceLiteralOnce(source, 'import { siteConfig } from "../../site.config";', 'import { siteConfig, blogFeatures } from "@/site.config";\nimport { withBase } from "@/utils/blog-template";', "src/components/layout/Header.astro", "URL helper import");
  result = replaceLiteralOnce(result, 'Astro.url.pathname === "/"', 'Astro.url.pathname === withBase("/")', "src/components/layout/Header.astro", "home route comparison");
  result = replaceLiteralOnce(result, 'href="/"', 'href={withBase("/")}', "src/components/layout/Header.astro", "home link");
  result = replaceLiteralOnce(result, "href={link.path}", "href={withBase(link.path)}", "src/components/layout/Header.astro", "menu links");
  return replaceLiteralOnce(result, "<Search />", "{blogFeatures.search !== false && <Search />}", "src/components/layout/Header.astro", "search visibility");
}

function adaptFile(source, file) {
  if (file === "astro.config.ts") return adaptAstroConfig(source);
  if (file === "src/content.config.ts") return canonicalContentConfig;
  if (file === "src/site.config.ts") return canonicalSiteConfig;
  if (file === "src/components/BaseHead.astro") return adaptBaseHead(source);
  if (file === "src/components/layout/Header.astro") return adaptHeader(source);

  let result = source;
  if (file === "src/components/layout/Footer.astro") {
    result = replaceLiteralOnce(result, 'import { menuLinks, siteConfig } from "@/site.config";', 'import { menuLinks, siteConfig } from "@/site.config";\nimport { withBase } from "@/utils/blog-template";', file, "URL helper import");
    return replaceLiteralOnce(result, "href={link.path}", "href={withBase(link.path)}", file, "menu links");
  }
  if (file === "src/components/SocialList.astro") {
    return `---
import { siteSocialLinks } from "@/site.config";
---

{siteSocialLinks.length > 0 && (
  <div class="flex flex-wrap items-end gap-x-2">
    <p>Links</p>
    <ul class="flex flex-1 items-center gap-x-2 sm:flex-initial" role="list">
      {siteSocialLinks.map((social) => (
        <li class="flex">
          <a class="hover:text-link inline-block" href={social.link} rel="noreferrer" target="_blank">
            {social.friendlyName}
          </a>
        </li>
      ))}
    </ul>
  </div>
)}
`;
  }
  if (file === "src/components/blog/PostPreview.astro") {
    result = replaceLiteralOnce(result, 'import FormattedDate from "@/components/FormattedDate.astro";', 'import FormattedDate from "@/components/FormattedDate.astro";\nimport { withBase } from "@/utils/blog-template";', file, "URL helper import");
    return replaceLiteralOnce(result, 'href={`/posts/${post.id}/`}', 'href={withBase(`/posts/${post.data.slug}/`)}', file, "stable article link");
  }
  if (file === "src/components/blog/Masthead.astro") {
    result = replaceLiteralOnce(result, 'import FormattedDate from "@/components/FormattedDate.astro";', 'import FormattedDate from "@/components/FormattedDate.astro";\nimport { withBase } from "@/utils/blog-template";', file, "URL helper import");
    return replaceLiteralOnce(result, 'href={`/tags/${tag}/`}', 'href={withBase(`/tags/${tag}/`)}', file, "tag link");
  }
  if (file === "src/components/Paginator.astro") {
    result = replaceLiteralOnce(result, 'import type { PaginationLink } from "@/types";', 'import type { PaginationLink } from "@/types";\nimport { withBase } from "@/utils/blog-template";', file, "URL helper import");
    result = replaceLiteralOnce(result, "href={prevUrl.url}", "href={withBase(prevUrl.url)}", file, "previous page link");
    return replaceLiteralOnce(result, "href={nextUrl.url}", "href={withBase(nextUrl.url)}", file, "next page link");
  }
  if (file === "src/pages/index.astro") {
    result = replaceLiteralOnce(result, 'import { collectionDateSort } from "@/utils/date";', 'import { collectionDateSort } from "@/utils/date";\nimport { withBase } from "@/utils/blog-template";\nimport { homeConfig } from "@/site.config";', file, "home configuration import");
    result = replaceLiteralOnce(result, 'title: "Home"', 'title: homeConfig.title', file, "home title");
    result = replaceLiteralOnce(result, '<h1 class="title mb-12">Hello World!</h1>', '<h1 class="title mb-12">{homeConfig.title}</h1>', file, "home heading");
    result = replaceOnce(result, /<p class="mb-4">[\s\S]*?<\/p>/, '<p class="mb-4">{homeConfig.description}</p>', file, "home description");
    result = replaceLiteralOnce(result, 'href="/posts/"', 'href={withBase("/posts/")}', file, "posts link");
    return replaceLiteralOnce(result, 'href="/notes/"', 'href={withBase("/notes/")}', file, "notes link");
  }
  if (file === "src/pages/about.astro") {
    return `---\nimport { getEntry, render } from "astro:content";\nimport PageLayout from "@/layouts/Base.astro";\n\nconst page = await getEntry("pages", "about");\nif (!page) throw new Error("The canonical About page is missing.");\nconst { Content } = await render(page);\nconst meta = { description: page.data.description ?? "About this blog", title: page.data.title };\n---\n\n<PageLayout meta={meta}>\n  <h1 class="title mb-12">{page.data.title}</h1>\n  <div class="prose prose-sm prose-cactus max-w-none"><Content /></div>\n</PageLayout>\n`;
  }
  if (file === "src/pages/posts/[...slug].astro") {
    return replaceLiteralOnce(result, "params: { slug: post.id }", "params: { slug: post.data.slug }", file, "stable article route");
  }
  if (file === "src/pages/posts/[...page].astro") {
    result = replaceLiteralOnce(result, 'import { collectionDateSort } from "@/utils/date";', 'import { collectionDateSort } from "@/utils/date";\nimport { withBase } from "@/utils/blog-template";', file, "URL helper import");
    result = replaceLiteralOnce(result, 'href="/rss.xml"', 'href={withBase("/rss.xml")}', file, "RSS link");
    result = replaceLiteralOnce(result, 'href={`/tags/${tag}/`}', 'href={withBase(`/tags/${tag}/`)}', file, "tag link");
    return replaceLiteralOnce(result, 'href="/tags/"', 'href={withBase("/tags/")}', file, "all tags link");
  }
  if (file === "src/pages/tags/index.astro") {
    result = replaceLiteralOnce(result, 'import PageLayout from "@/layouts/Base.astro";', 'import PageLayout from "@/layouts/Base.astro";\nimport { withBase } from "@/utils/blog-template";', file, "URL helper import");
    return replaceLiteralOnce(result, 'href={`/tags/${tag}/`}', 'href={withBase(`/tags/${tag}/`)}', file, "tag link");
  }
  if (file === "src/pages/tags/[tag]/[...page].astro") {
    result = replaceLiteralOnce(result, 'import { collectionDateSort } from "@/utils/date";', 'import { collectionDateSort } from "@/utils/date";\nimport { withBase } from "@/utils/blog-template";', file, "URL helper import");
    return replaceLiteralOnce(result, 'href="/tags/"', 'href={withBase("/tags/")}', file, "tag breadcrumb");
  }
  if (file === "src/pages/rss.xml.ts") {
    result = replaceLiteralOnce(result, 'link: `posts/${post.id}/`', 'link: `posts/${post.data.slug}/`', file, "stable feed link");
    return replaceLiteralOnce(result, "site: import.meta.env.SITE", "site: siteConfig.url", file, "feed base URL");
  }
  if (file === "src/layouts/BlogPost.astro") {
    result = replaceLiteralOnce(result, 'import BaseLayout from "./Base.astro";', 'import BaseLayout from "./Base.astro";\nimport { withBase } from "@/utils/blog-template";', file, "URL helper import");
    return replaceLiteralOnce(result, 'const socialImage = ogImage ?? `/og-image/${post.id}.png`;', 'const socialImage = ogImage ?? withBase(`/og-image/${post.data.slug}.png`);', file, "stable social image URL");
  }
  if (file === "src/pages/og-image/[...slug].png.ts") {
    return replaceLiteralOnce(result, "params: { slug: post.id }", "params: { slug: post.data.slug }", file, "stable social image path");
  }
  if (file === "src/layouts/Base.astro") {
    return replaceLiteralOnce(result, "lang={siteConfig.lang}", "lang={siteConfig.lang} dir={siteConfig.dir}", file, "document direction");
  }
  if (file === "src/components/blog/webmentions/index.astro") {
    result = replaceLiteralOnce(result, 'import Likes from "./Likes.astro";', 'import Likes from "./Likes.astro";\nimport { absoluteSiteUrl } from "@/utils/blog-template";', file, "canonical URL helper");
    result = replaceLiteralOnce(result, "const url = new URL(Astro.url.pathname, Astro.site);", "const url = absoluteSiteUrl(Astro.url.pathname);", file, "canonical Webmention URL");
    return replaceLiteralOnce(result, "getWebmentionsForUrl(`${url}`)", "getWebmentionsForUrl(url)", file, "Webmention target URL");
  }
  if (file === "src/types.ts") {
    return replaceLiteralOnce(result, "lang: string;", "lang: string;\n\tdir: string;", file, "document direction type");
  }
  return result;
}

export function normalizedCactusContents(contents, file) {
  if (file === "package.json") {
    const packageJson = JSON.parse(contents.toString("utf8"));
    packageJson.name = "blogkit";
    packageJson.private = true;
    return Buffer.from(`${JSON.stringify(packageJson, null, 2)}\n`);
  }
  if (/\.(?:png|jpe?g|ttf|woff2?)$/i.test(file)) return Buffer.from(contents);
  const source = contents.toString("utf8");
  if (file === "src/utils/blog-template.ts") return Buffer.from(templateUrlHelpers);
  return Buffer.from(adaptFile(source, file));
}

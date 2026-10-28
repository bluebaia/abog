import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateBlogConfiguration } from "./blog-config.mjs";
import {
  createGitHubApi,
  getRepositoryDetails,
  readPagesStatus,
  repositoryRoute,
} from "./github-api.mjs";

const controlLabels = new Set(["blog", "note", "published", "publishing"]);

function fail(message) {
  throw new Error(message);
}

function parseRepository(value) {
  const parts = value?.split("/") ?? [];
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    fail("GITHUB_REPOSITORY must contain an owner and repository name.");
  }
  return { owner: parts[0], name: parts[1] };
}

function parseSourceUrl(value, targetRepository) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("Enter a GitHub Issue URL or a Note comment permalink.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.username ||
    url.password ||
    url.search
  ) {
    fail(
      "The source must be a direct https://github.com Issue or comment link.",
    );
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[2] !== "issues" || !/^\d+$/.test(parts[3])) {
    fail(
      "Use an Issue URL, or a comment permalink ending in #issuecomment-ID.",
    );
  }
  const [owner, name] = parts;
  if (
    owner.toLowerCase() !== targetRepository.owner.toLowerCase() ||
    name.toLowerCase() !== targetRepository.name.toLowerCase()
  ) {
    fail("The source link belongs to another repository.");
  }
  const commentMatch = url.hash.match(/^#issuecomment-(\d+)$/);
  if (url.hash && !commentMatch) {
    fail("The comment link must use GitHub's #issuecomment-ID permalink.");
  }
  const issueNumber = Number(parts[3]);
  const commentId = commentMatch ? Number(commentMatch[1]) : undefined;
  if (
    !Number.isSafeInteger(issueNumber) ||
    issueNumber < 1 ||
    (commentId !== undefined &&
      (!Number.isSafeInteger(commentId) || commentId < 1))
  ) {
    fail("The source link contains an invalid Issue or comment identifier.");
  }
  return {
    issueNumber,
    commentId,
    url: `https://github.com/${owner}/${name}/issues/${parts[3]}${commentMatch ? `#issuecomment-${commentMatch[1]}` : ""}`,
  };
}

function readJson(filePath, description) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    fail(`Cannot read ${description}. Run the configuration task first.`);
  }
}

function labelsOf(issue) {
  return issue.labels.map((label) =>
    typeof label === "string" ? label : label.name,
  );
}

function hasLabel(issue, expected) {
  return labelsOf(issue).some(
    (label) => label.toLowerCase() === expected.toLowerCase(),
  );
}

function metadataFromComment(body) {
  const valueFor = (name) =>
    body
      .match(new RegExp(`<!--\\s*${name}:\\s*([\\s\\S]*?)-->`, "i"))?.[1]
      ?.trim();
  const rawTags = valueFor("tags");
  const tags = rawTags
    ? rawTags.includes("\n")
      ? rawTags
          .split("\n")
          .map((line) => line.replace(/^\s*-\s*/, "").trim())
          .filter(Boolean)
      : rawTags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
    : [];
  const content = body
    .replace(/<!--\s*(?:title|description|tags):[\s\S]*?-->/gi, "")
    .trim();
  return {
    title: valueFor("title"),
    description: valueFor("description"),
    tags,
    content,
  };
}

function visibleText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[>#*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function noteTitle(metadata, createdAt) {
  if (metadata.title) return metadata.title;
  const heading = metadata.content
    .match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]
    ?.trim();
  if (heading) return heading;
  const firstSentence = visibleText(metadata.content)
    .split(/[.!?。！？]/)[0]
    ?.trim();
  if (firstSentence) return Array.from(firstSentence).slice(0, 80).join("");
  return `Note from ${createdAt.slice(0, 10)}`;
}

function noteDescription(metadata) {
  return (
    metadata.description ||
    Array.from(visibleText(metadata.content)).slice(0, 180).join("")
  );
}

function safeTimestamp(value, field) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf()))
    fail(`GitHub returned an invalid ${field} timestamp.`);
  return timestamp.toISOString();
}

function articleFromIssue(issue, configuration) {
  if (issue.pull_request)
    fail("Pull requests cannot be published as articles.");
  if (!hasLabel(issue, configuration.writing.blogLabel)) {
    fail(
      `Add the “${configuration.writing.blogLabel}” label before publishing this Issue.`,
    );
  }
  const body = issue.body?.trim();
  if (!body) fail("This Issue has no article text to publish.");
  const labels = labelsOf(issue);
  const tags = labels.filter(
    (label) => !controlLabels.has(label.toLowerCase()),
  );
  return {
    identity: { kind: "blog-issue", id: String(issue.id) },
    slug: `blog-${issue.number}`,
    title: issue.title,
    author: issue.user.login,
    description: Array.from(visibleText(body)).slice(0, 180).join(""),
    tags,
    featured: labels.some((label) => label.toLowerCase() === "featured"),
    pubDatetime: safeTimestamp(issue.created_at, "Issue creation"),
    modDatetime: safeTimestamp(
      issue.updated_at ?? issue.created_at,
      "Issue update",
    ),
    timezone: configuration.site.timezone,
    body,
    source: {
      kind: "blog-issue",
      id: String(issue.id),
      issueNumber: issue.number,
      updatedAt: issue.updated_at,
    },
  };
}

function articleFromComment(comment, issue, configuration, state) {
  if (issue.number !== state.resources.noteContainer.number) {
    fail("This comment is not in the configured Note container.");
  }
  if (!hasLabel(issue, configuration.writing.noteLabel)) {
    fail(
      `The Note container must have the “${configuration.writing.noteLabel}” label. Run configuration again to repair it.`,
    );
  }
  const metadata = metadataFromComment(comment.body ?? "");
  if (!metadata.content) fail("This Note comment has no text to publish.");
  const createdAt = safeTimestamp(comment.created_at, "comment creation");
  return {
    identity: { kind: "note-comment", id: String(comment.id) },
    slug: `note-${comment.id}`,
    title: noteTitle(metadata, createdAt),
    author: comment.user.login,
    description: noteDescription(metadata),
    tags: metadata.tags,
    featured: false,
    pubDatetime: createdAt,
    modDatetime: safeTimestamp(
      comment.updated_at ?? comment.created_at,
      "comment update",
    ),
    timezone: configuration.site.timezone,
    body: metadata.content,
    source: {
      kind: "note-comment",
      id: String(comment.id),
      issueNumber: issue.number,
      commentId: comment.id,
      updatedAt: comment.updated_at,
    },
  };
}

function yamlString(value) {
  return JSON.stringify(value);
}

function formatArticle(article) {
  const fields = [
    `identity: ${JSON.stringify(article.identity)}`,
    `slug: ${yamlString(article.slug)}`,
    `author: ${yamlString(article.author)}`,
    `pubDatetime: ${article.pubDatetime}`,
    `modDatetime: ${article.modDatetime}`,
    `timezone: ${yamlString(article.timezone)}`,
    `title: ${yamlString(article.title)}`,
    `description: ${yamlString(article.description)}`,
    `tags: ${JSON.stringify(article.tags)}`,
    `featured: ${article.featured}`,
  ];
  return `---\n${fields.join("\n")}\n---\n\n${article.body.trimEnd()}\n`;
}

function writeFileAtomically(filePath, contents) {
  const buffer = Buffer.from(contents);
  if (existsSync(filePath) && readFileSync(filePath).equals(buffer))
    return false;
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, buffer, { mode: 0o600 });
  renameSync(temporaryPath, filePath);
  return true;
}

function articleUrl(siteUrl, slug) {
  const url = new URL(siteUrl);
  const rootPath = url.pathname.endsWith("/")
    ? url.pathname
    : `${url.pathname}/`;
  url.pathname = `${rootPath}posts/${slug}/`;
  return url.href;
}

function writeOutputs(values, env) {
  if (!env.GITHUB_OUTPUT) return;
  writeFileSync(
    env.GITHUB_OUTPUT,
    `${Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n")}\n`,
    { flag: "a" },
  );
}

function writeSummary({ repository, source, article, url, snapshotId }, env) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  writeFileSync(
    env.GITHUB_STEP_SUMMARY,
    [
      "# Publication snapshot prepared",
      "",
      `- Repository: ${repository.owner}/${repository.name}`,
      `- Source: [open the source](${source.url})`,
      `- Article: [View article](${url})`,
      `- Snapshot: \`${snapshotId}\``,
      "",
      "The site is marked as published only after the deployment step succeeds.",
      "",
    ].join("\n"),
    { flag: "a" },
  );
}

export async function publishBlog({
  env = process.env,
  projectRoot = process.cwd(),
  fetchImplementation = fetch,
  stdout = process.stdout,
} = {}) {
  const repository = parseRepository(env.GITHUB_REPOSITORY);
  const source = parseSourceUrl(env.SOURCE_URL ?? "", repository);
  const api = createGitHubApi({
    token: env.GITHUB_TOKEN,
    apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
    fetchImplementation,
  });
  const repositoryDetails = await getRepositoryDetails(api, repository);
  const repositoryContext = {
    owner: repositoryDetails.owner.login,
    name: repositoryDetails.name,
    defaultBranch: repositoryDetails.default_branch,
  };
  const configuration = readJson(
    path.join(projectRoot, ".blog", "config.json"),
    "the blog configuration",
  );
  const setupState = readJson(
    path.join(projectRoot, ".template", "state.json"),
    "the setup resource state",
  );
  if (
    !setupState ||
    typeof setupState !== "object" ||
    Array.isArray(setupState) ||
    setupState.schemaVersion !== 1
  ) {
    fail(
      "The setup resource state is invalid. Run the configuration task again.",
    );
  }
  const errors = validateBlogConfiguration(configuration, repositoryContext);
  if (errors.length) {
    fail(errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  }
  const pages = await readPagesStatus(
    api,
    repository,
    env.GITHUB_SERVER_URL ?? "https://github.com",
  );
  if (!pages.publishReady) {
    fail(
      `GitHub Pages is not ready. Choose **GitHub Actions** in [Pages settings](${pages.settingsUrl}), then retry.`,
    );
  }

  const issueRoute = repositoryRoute(
    repository,
    `/issues/${source.issueNumber}`,
  );
  const issueResponse = await api(issueRoute);
  const issue = await issueResponse.json();
  let article;
  let canonicalSourceUrl = `https://github.com/${repository.owner}/${repository.name}/issues/${source.issueNumber}`;
  if (source.commentId) {
    const commentResponse = await api(
      repositoryRoute(repository, `/issues/comments/${source.commentId}`),
    );
    const comment = await commentResponse.json();
    if (Number(comment.issue_url.split("/").at(-1)) !== source.issueNumber) {
      fail("The comment permalink does not belong to the Issue in its URL.");
    }
    canonicalSourceUrl += `#issuecomment-${source.commentId}`;
    if (!Number.isSafeInteger(setupState.resources?.noteContainer?.number)) {
      fail(
        "The Note container is missing from setup state. Run the configuration task again.",
      );
    }
    article = articleFromComment(comment, issue, configuration, setupState);
  } else {
    article = articleFromIssue(issue, configuration);
    article.sourceUrl = canonicalSourceUrl;
  }

  const markdown = formatArticle(article);
  const sourceDigest = createHash("sha256")
    .update(JSON.stringify({ ...article.source, body: article.body }))
    .digest("hex");
  const markdownDigest = createHash("sha256").update(markdown).digest("hex");
  const deploymentKey = `${article.identity.kind}:${article.identity.id}`;
  const fileName = `${article.identity.kind}-${article.identity.id}.md`;
  const articlePath = path.join(
    projectRoot,
    ".blog",
    "content",
    "posts",
    fileName,
  );
  const receiptPath = path.join(
    projectRoot,
    ".blog",
    "receipts",
    `${article.identity.kind}-${article.identity.id}.json`,
  );
  const url = articleUrl(configuration.site.url, article.slug);
  const receipt = {
    schemaVersion: 1,
    source: {
      ...article.source,
      repository: `${repository.owner}/${repository.name}`,
      url: canonicalSourceUrl,
      bodySha256: sourceDigest,
    },
    publication: {
      slug: article.slug,
      path: path.relative(projectRoot, articlePath).split(path.sep).join("/"),
      contentSha256: markdownDigest,
      url,
    },
  };
  const articleChanged = writeFileAtomically(articlePath, markdown);
  const receiptChanged = writeFileAtomically(
    receiptPath,
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  const changed = articleChanged || receiptChanged;
  const needsDeployment =
    setupState.deployments?.publishedSnapshots?.[deploymentKey] !==
    markdownDigest;
  const snapshotId = markdownDigest.slice(0, 16);
  writeOutputs(
    {
      changed: String(Boolean(changed)),
      needs_deployment: String(needsDeployment),
      source_kind: article.identity.kind,
      source_id: article.identity.id,
      article_url: url,
      source_revision: sourceDigest,
      snapshot_id: snapshotId,
      snapshot_sha256: markdownDigest,
    },
    env,
  );
  writeSummary(
    {
      repository,
      source: { url: canonicalSourceUrl },
      article,
      url,
      snapshotId,
    },
    env,
  );
  stdout.write(
    `Prepared ${Boolean(changed) ? "a new" : "the existing"} publication snapshot for ${repository.owner}/${repository.name}.\n`,
  );
  return {
    article,
    changed: Boolean(changed),
    markdown,
    needsDeployment,
    receipt,
    snapshotId,
    snapshotSha256: markdownDigest,
    url,
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  publishBlog().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

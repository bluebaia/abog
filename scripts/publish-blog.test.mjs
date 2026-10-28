import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { publishBlog } from "./publish-blog.mjs";
import { recordDeployment } from "./record-deployment.mjs";

function makeConfiguration() {
  return {
    schemaVersion: 1,
    repository: { owner: "writer", name: "journal", defaultBranch: "main" },
    writing: {
      noteLabel: "Note",
      blogLabel: "Blog",
      noteContainerTitle: "Notes",
    },
    theme: {
      id: "astro-paper",
      options: { "astro-paper": {}, "astro-cactus": {} },
    },
    site: {
      url: "https://writer.github.io/journal/",
      title: "A public journal",
      description: "Short public writing.",
      author: "Writer",
      ogImage: "default-og.jpg",
      lang: "en",
      timezone: "UTC",
      dir: "ltr",
    },
    home: {
      title: "A public journal",
      description: "Welcome to this journal.",
      readmeUrl: "https://github.com/writer/journal",
    },
    posts: { perPage: 10, perIndex: 10, scheduledPostMargin: 900000 },
    features: {
      lightAndDarkMode: true,
      dynamicOgImage: true,
      showArchives: true,
      showBackButton: true,
      editPost: { enabled: false },
      search: "pagefind",
    },
    socials: [],
    shareLinks: [{ name: "mail", url: "mailto:?subject=Hello&body=" }],
  };
}

function createApi({ issue, comment, pagesReady = true }) {
  const requests = [];
  return {
    requests,
    fetchImplementation: async (input) => {
      const url = new URL(input);
      const route = url.pathname.replace("/repos/writer/journal", "");
      requests.push(route);
      if (route === "" && url.pathname.endsWith("/repos/writer/journal")) {
        return Response.json({
          visibility: "public",
          default_branch: "main",
          name: "journal",
          owner: { login: "writer" },
        });
      }
      if (route === "/pages") {
        return pagesReady
          ? Response.json({
              build_type: "workflow",
              html_url: "https://writer.github.io/journal/",
            })
          : Response.json({ message: "Not Found" }, { status: 404 });
      }
      if (route === `/issues/${issue.number}`) return Response.json(issue);
      if (comment && route === `/issues/comments/${comment.id}`) {
        return Response.json(comment);
      }
      return Response.json({ message: "Not Found" }, { status: 404 });
    },
  };
}

function issueFixture() {
  return {
    id: 777,
    number: 17,
    title: 'First title: "portable"',
    body: "# Article body\n\nA public snapshot with `quotes` and YAML-like text: value.",
    labels: [{ name: "Blog" }, { name: "Engineering" }],
    user: { login: "writer" },
    created_at: "2026-10-01T12:00:00Z",
    updated_at: "2026-10-02T12:00:00Z",
  };
}

function prepareProject(projectRoot) {
  mkdirSync(path.join(projectRoot, ".blog"), { recursive: true });
  mkdirSync(path.join(projectRoot, ".template"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, ".blog/config.json"),
    `${JSON.stringify(makeConfiguration(), null, 2)}\n`,
  );
  writeFileSync(
    path.join(projectRoot, ".template/state.json"),
    `${JSON.stringify({ schemaVersion: 1, resources: { noteContainer: { number: 4 } } })}\n`,
  );
}

function environment(projectRoot, sourceUrl) {
  return {
    GITHUB_REPOSITORY: "writer/journal",
    GITHUB_TOKEN: "test-token",
    GITHUB_API_URL: "https://api.example.test",
    GITHUB_SERVER_URL: "https://github.com",
    SOURCE_URL: sourceUrl,
    GITHUB_OUTPUT: path.join(projectRoot, "outputs.txt"),
    GITHUB_STEP_SUMMARY: path.join(projectRoot, "summary.md"),
  };
}

test("publishes an Issue snapshot to a stable route and safely repeats it", async (t) => {
  const projectRoot = mkdtempSync(
    path.join(os.tmpdir(), "publish-blog-issue-"),
  );
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  prepareProject(projectRoot);
  const issue = issueFixture();
  const api = createApi({ issue });
  const env = environment(
    projectRoot,
    "https://github.com/writer/journal/issues/17",
  );
  const stdout = { write: () => {} };

  const first = await publishBlog({
    env,
    projectRoot,
    fetchImplementation: api.fetchImplementation,
    stdout,
  });
  recordDeployment({
    projectRoot,
    env: {
      SOURCE_KIND: first.article.identity.kind,
      SOURCE_ID: first.article.identity.id,
      SNAPSHOT_SHA256: first.snapshotSha256,
      ARTICLE_URL: first.url,
    },
    stdout,
  });
  const second = await publishBlog({
    env,
    projectRoot,
    fetchImplementation: api.fetchImplementation,
    stdout,
  });

  const markdownPath = path.join(
    projectRoot,
    ".blog/content/posts/blog-issue-777.md",
  );
  const receipt = JSON.parse(
    readFileSync(
      path.join(projectRoot, ".blog/receipts/blog-issue-777.json"),
      "utf8",
    ),
  );
  assert.equal(first.article.slug, "blog-17");
  assert.equal(first.url, "https://writer.github.io/journal/posts/blog-17/");
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(first.needsDeployment, true);
  assert.equal(second.needsDeployment, false);
  const markdown = readFileSync(markdownPath, "utf8");
  assert.match(markdown, /identity: \{"kind":"blog-issue","id":"777"\}/);
  assert.equal((markdown.match(/^tags:/gm) ?? []).length, 1);
  assert.ok(markdown.includes(`title: ${JSON.stringify(issue.title)}`));
  assert.match(
    readFileSync(markdownPath, "utf8"),
    /pubDatetime: 2026-10-01T12:00:00.000Z/,
  );
  assert.match(
    readFileSync(markdownPath, "utf8"),
    /A public snapshot with `quotes`/,
  );
  assert.deepEqual(receipt.publication.slug, "blog-17");
  assert.match(receipt.source.bodySha256, /^[0-9a-f]{64}$/);
  assert.equal(
    readFileSync(env.GITHUB_OUTPUT, "utf8").includes("changed=false"),
    true,
  );
  assert.doesNotMatch(
    readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"),
    /A public snapshot/,
  );

  issue.title = "A renamed title";
  issue.updated_at = "2026-10-03T12:00:00Z";
  const renamed = await publishBlog({
    env,
    projectRoot,
    fetchImplementation: api.fetchImplementation,
    stdout,
  });
  assert.equal(renamed.article.slug, "blog-17");
  assert.equal(renamed.changed, true);
  assert.equal(renamed.needsDeployment, true);
  assert.ok(
    readFileSync(markdownPath, "utf8").includes(
      `title: ${JSON.stringify(issue.title)}`,
    ),
  );
});

test("publishes a Note comment only from the configured Note container", async (t) => {
  const projectRoot = mkdtempSync(path.join(os.tmpdir(), "publish-blog-note-"));
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  prepareProject(projectRoot);
  const issue = {
    ...issueFixture(),
    id: 404,
    number: 4,
    title: "Notes",
    body: "<!-- blogkit:note-container:v1 -->",
    labels: [{ name: "Note" }],
  };
  const comment = {
    id: 900,
    issue_url: "https://api.github.com/repos/writer/journal/issues/4",
    body: "<!-- title: A short note -->\n<!-- description: A note excerpt. -->\n<!-- tags: writing, travel -->\n\nA useful thought for today.",
    user: { login: "writer" },
    created_at: "2026-10-05T07:08:09Z",
    updated_at: "2026-10-05T07:08:09Z",
  };
  const api = createApi({ issue, comment });
  const result = await publishBlog({
    env: environment(
      projectRoot,
      "https://github.com/writer/journal/issues/4#issuecomment-900",
    ),
    projectRoot,
    fetchImplementation: api.fetchImplementation,
    stdout: { write: () => {} },
  });

  const markdown = readFileSync(
    path.join(projectRoot, ".blog/content/posts/note-comment-900.md"),
    "utf8",
  );
  assert.equal(result.article.identity.kind, "note-comment");
  assert.equal(result.article.slug, "note-900");
  assert.match(markdown, /title: "A short note"/);
  assert.match(markdown, /description: "A note excerpt\."/);
  assert.match(markdown, /tags: \["writing","travel"\]/);
  assert.match(markdown, /A useful thought for today\./);
  assert.doesNotMatch(markdown, /<!-- title:/);
});

test("rejects foreign repositories and waits for Pages before writing a snapshot", async (t) => {
  const projectRoot = mkdtempSync(
    path.join(os.tmpdir(), "publish-blog-safety-"),
  );
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  prepareProject(projectRoot);
  const issue = issueFixture();
  const api = createApi({ issue, pagesReady: false });

  await assert.rejects(
    publishBlog({
      env: environment(
        projectRoot,
        "https://github.com/another-person/journal/issues/17",
      ),
      projectRoot,
      fetchImplementation: api.fetchImplementation,
      stdout: { write: () => {} },
    }),
    /belongs to another repository/,
  );
  assert.equal(api.requests.length, 0);

  await assert.rejects(
    publishBlog({
      env: environment(
        projectRoot,
        "https://github.com/writer/journal/issues/17",
      ),
      projectRoot,
      fetchImplementation: api.fetchImplementation,
      stdout: { write: () => {} },
    }),
    /GitHub Pages is not ready/,
  );
  assert.equal(api.requests.includes("/issues/17"), false);
  assert.throws(
    () =>
      readFileSync(
        path.join(projectRoot, ".blog/content/posts/blog-issue-777.md"),
        "utf8",
      ),
    { code: "ENOENT" },
  );
});

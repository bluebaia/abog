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
import { configureBlog } from "./configure-blog.mjs";

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

function createGitHubApi({ pagesReady = true } = {}) {
  const labels = [];
  const issues = [];
  const requests = [];
  let nextIssueNumber = 1;

  return {
    labels,
    issues,
    requests,
    fetchImplementation: async (input, init = {}) => {
      const url = new URL(input);
      const method = init.method ?? "GET";
      const route = url.pathname.replace("/repos/writer/journal", "");
      const body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({ method, route, body });

      if (route === "" && method === "GET") {
        return Response.json({
          visibility: "public",
          default_branch: "main",
          name: "journal",
          owner: { login: "writer" },
        });
      }
      if (route === "/labels" && method === "GET") return Response.json(labels);
      if (route === "/labels" && method === "POST") {
        const label = { ...body };
        labels.push(label);
        return Response.json(label, { status: 201 });
      }
      if (route === "/issues" && method === "GET") return Response.json(issues);
      const existingIssueMatch = route.match(/^\/issues\/(\d+)$/);
      if (existingIssueMatch && method === "GET") {
        const issue = issues.find(
          (item) => item.number === Number(existingIssueMatch[1]),
        );
        return issue
          ? Response.json(issue)
          : Response.json({ message: "Not Found" }, { status: 404 });
      }
      if (route === "/issues" && method === "POST") {
        const issue = {
          ...body,
          labels: body.labels.map((name) => ({ name })),
          number: nextIssueNumber++,
          html_url: `https://github.com/writer/journal/issues/${nextIssueNumber - 1}`,
          state: "open",
        };
        issues.push(issue);
        return Response.json(issue, { status: 201 });
      }
      const issueLabelsMatch = route.match(/^\/issues\/(\d+)\/labels$/);
      if (issueLabelsMatch && method === "POST") {
        const issue = issues.find(
          (item) => item.number === Number(issueLabelsMatch[1]),
        );
        for (const name of body.labels) {
          if (!issue.labels.some((label) => label.name === name)) {
            issue.labels.push({ name });
          }
        }
        return Response.json(issue.labels);
      }
      const issueMatch = route.match(/^\/issues\/(\d+)$/);
      if (issueMatch && method === "PATCH") {
        const issue = issues.find(
          (item) => item.number === Number(issueMatch[1]),
        );
        Object.assign(issue, body);
        return Response.json(issue);
      }
      if (route === "/pages" && method === "GET") {
        if (!pagesReady)
          return Response.json({ message: "Not Found" }, { status: 404 });
        return Response.json({
          build_type: "workflow",
          html_url: "https://writer.github.io/journal/",
        });
      }
      return Response.json(
        { message: `Unexpected API request: ${method} ${route}` },
        { status: 404 },
      );
    },
  };
}

function testEnvironment(projectRoot, configuration) {
  return {
    GITHUB_REPOSITORY: "writer/journal",
    GITHUB_TOKEN: "test-token",
    GITHUB_API_URL: "https://api.example.test",
    BLOG_CONFIGURATION: JSON.stringify(configuration),
    GITHUB_STEP_SUMMARY: path.join(projectRoot, "summary.md"),
    GITHUB_OUTPUT: path.join(projectRoot, "outputs.txt"),
  };
}

test("saves a checked configuration and reuses labels and the Note container on retry", async (t) => {
  const projectRoot = mkdtempSync(
    path.join(os.tmpdir(), "configure-blog-retry-"),
  );
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  mkdirSync(path.join(projectRoot, ".template"), { recursive: true });
  writeFileSync(
    path.join(projectRoot, ".template/state.json"),
    JSON.stringify({ schemaVersion: 1, themeBaseline: { ref: "v6.1.0" } }),
  );
  const api = createGitHubApi();
  const env = testEnvironment(projectRoot, makeConfiguration());
  const output = { write: () => {} };

  await configureBlog({
    env,
    projectRoot,
    fetchImplementation: api.fetchImplementation,
    stdout: output,
  });
  await configureBlog({
    env,
    projectRoot,
    fetchImplementation: api.fetchImplementation,
    stdout: output,
  });

  const saved = JSON.parse(
    readFileSync(path.join(projectRoot, ".blog/config.json"), "utf8"),
  );
  const state = JSON.parse(
    readFileSync(path.join(projectRoot, ".template/state.json"), "utf8"),
  );
  assert.deepEqual(saved, makeConfiguration());
  assert.deepEqual(state.themeBaseline, { ref: "v6.1.0" });
  assert.equal(state.resources.noteContainer.number, 1);
  assert.equal(api.labels.length, 2);
  assert.equal(api.issues.length, 1);
  assert.deepEqual(api.issues[0].labels, [{ name: "Note" }]);
  assert.equal(
    api.requests.filter(
      (request) => request.method === "POST" && request.route === "/issues",
    ).length,
    1,
  );
  assert.equal(
    readFileSync(env.GITHUB_OUTPUT, "utf8"),
    "publish_ready=true\ntheme_id=astro-paper\npublish_ready=true\ntheme_id=astro-paper\n",
  );
  assert.match(readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"), /#1/);
  assert.doesNotMatch(
    readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"),
    /Short public writing/,
  );

  api.issues[0].body = "Edited note container";
  await assert.rejects(
    configureBlog({
      env,
      projectRoot,
      fetchImplementation: api.fetchImplementation,
      stdout: output,
    }),
    /lost its ownership marker/,
  );
  assert.equal(api.issues.length, 1);
});

test("saves settings but reports the one-time Pages action when publishing is not configured", async (t) => {
  const projectRoot = mkdtempSync(
    path.join(os.tmpdir(), "configure-blog-pages-"),
  );
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const api = createGitHubApi({ pagesReady: false });
  const env = testEnvironment(projectRoot, makeConfiguration());

  await configureBlog({
    env,
    projectRoot,
    fetchImplementation: api.fetchImplementation,
    stdout: { write: () => {} },
  });

  assert.equal(
    JSON.parse(
      readFileSync(path.join(projectRoot, ".blog/config.json"), "utf8"),
    ).schemaVersion,
    1,
  );
  assert.equal(
    readFileSync(env.GITHUB_OUTPUT, "utf8"),
    "publish_ready=false\ntheme_id=astro-paper\n",
  );
  assert.match(
    readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"),
    /choose \*\*GitHub Actions\*\* as the source/,
  );
});

test("rejects settings for another default branch before creating resources", async (t) => {
  const projectRoot = mkdtempSync(
    path.join(os.tmpdir(), "configure-blog-mismatch-"),
  );
  t.after(() => rmSync(projectRoot, { recursive: true, force: true }));
  const api = createGitHubApi();
  const configuration = makeConfiguration();
  configuration.repository.defaultBranch = "trunk";
  const env = testEnvironment(projectRoot, configuration);

  await assert.rejects(
    configureBlog({
      env,
      projectRoot,
      fetchImplementation: api.fetchImplementation,
      stdout: { write: () => {} },
    }),
    /repository\.defaultBranch: does not match the target repository context/,
  );

  assert.equal(api.labels.length, 0);
  assert.equal(api.issues.length, 0);
  assert.throws(
    () => readFileSync(path.join(projectRoot, ".blog/config.json"), "utf8"),
    { code: "ENOENT" },
  );
});

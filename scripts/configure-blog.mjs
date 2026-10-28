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
  listAllItems,
  readPagesStatus,
  repositoryRoute,
} from "./github-api.mjs";

const noteContainerMarker = "<!-- blogkit:note-container:v1 -->";

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

function writeJsonAtomically(filePath, value) {
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  if (existsSync(filePath) && readFileSync(filePath, "utf8") === contents)
    return false;
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, contents, { mode: 0o600 });
  renameSync(temporaryPath, filePath);
  return true;
}

async function ensureLabels(api, repository, writing) {
  const route = repositoryRoute(repository, "/labels");
  const labels = await listAllItems(api, `${route}?per_page=100`);
  const existingNames = new Set(
    labels.map((label) => label.name.toLowerCase()),
  );
  for (const [name, color, description] of [
    [writing.noteLabel, "176B73", "Short public notes for the blog."],
    [writing.blogLabel, "B78332", "Long public articles for the blog."],
  ]) {
    if (existingNames.has(name.toLowerCase())) continue;
    await api(route, {
      method: "POST",
      body: JSON.stringify({ name, color, description }),
    });
    existingNames.add(name.toLowerCase());
  }
}

function noteContainerBody() {
  return `${noteContainerMarker}\n\nUse this issue to collect short notes. Publish a note from its comment link with the blog publishing workflow.`;
}

async function ensureNoteContainer(
  api,
  repository,
  title,
  noteLabel,
  savedIssueNumber,
) {
  const route = repositoryRoute(repository, "/issues");
  const existing = Number.isSafeInteger(savedIssueNumber)
    ? await api(`${route}/${savedIssueNumber}`).then((response) =>
        response.json(),
      )
    : (await listAllItems(api, `${route}?state=all&per_page=100`)).find(
        (issue) => issue.body?.includes(noteContainerMarker),
      );
  if (existing) {
    if (!existing.body?.includes(noteContainerMarker)) {
      fail(
        "The saved Note container lost its ownership marker. Restore the marker before retrying.",
      );
    }
    const hasNoteLabel = existing.labels?.some(
      (label) => label.name.toLowerCase() === noteLabel.toLowerCase(),
    );
    if (!hasNoteLabel) {
      await api(`${route}/${existing.number}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels: [noteLabel] }),
      });
    }
    if (existing.title !== title || existing.state !== "open") {
      const response = await api(`${route}/${existing.number}`, {
        method: "PATCH",
        body: JSON.stringify({ title, state: "open" }),
      });
      return response.json();
    }
    return existing;
  }
  const response = await api(route, {
    method: "POST",
    body: JSON.stringify({
      title,
      body: noteContainerBody(),
      labels: [noteLabel],
    }),
  });
  return response.json();
}

function writeWorkflowOutputs(values, env) {
  if (!env.GITHUB_OUTPUT) return;
  const output = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  writeFileSync(env.GITHUB_OUTPUT, `${output}\n`, { flag: "a" });
}

function writeStepSummary(
  { repository, configuration, noteContainer, pages },
  env,
) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  const webUrl = env.GITHUB_SERVER_URL ?? "https://github.com";
  const repositoryUrl = `${webUrl}/${repository.owner}/${repository.name}`;
  const newBlogIssueUrl = new URL(`${repositoryUrl}/issues/new`);
  newBlogIssueUrl.searchParams.set("labels", configuration.writing.blogLabel);
  const settings = pages.publishReady
    ? `Pages is ready. The setup workflow will validate and publish this configuration to ${configuration.site.url}.`
    : `Settings and writing resources are saved. To publish, open [Pages settings](${pages.settingsUrl}), choose **GitHub Actions** as the source, then run the setup task again.`;
  const summary = [
    "# Blog setup",
    "",
    `- Repository: ${repository.owner}/${repository.name}`,
    `- Site address: ${configuration.site.url}`,
    `- Note container: [#${noteContainer.number}](${noteContainer.html_url})`,
    `- Write a long article: [Create a Blog Issue](${newBlogIssueUrl.href})`,
    `- Publish a saved source: [Open Publish an article](${repositoryUrl}/actions/workflows/publish-blog.yml)`,
    `- Pages: ${settings}`,
    "",
  ].join("\n");
  writeFileSync(env.GITHUB_STEP_SUMMARY, summary, { flag: "a" });
}

export async function configureBlog({
  env = process.env,
  projectRoot = process.cwd(),
  fetchImplementation = fetch,
  stdout = process.stdout,
} = {}) {
  const repository = parseRepository(env.GITHUB_REPOSITORY);
  const token = env.GITHUB_TOKEN;
  const api = createGitHubApi({
    token,
    apiUrl: env.GITHUB_API_URL ?? "https://api.github.com",
    fetchImplementation,
  });
  const repositoryDetails = await getRepositoryDetails(api, repository);

  let configuration;
  try {
    configuration = JSON.parse(env.BLOG_CONFIGURATION ?? "");
  } catch {
    fail(
      "The configuration input must contain valid JSON. Return to the setup page and copy the complete settings again.",
    );
  }
  const repositoryContext = {
    owner: repositoryDetails.owner.login,
    name: repositoryDetails.name,
    defaultBranch: repositoryDetails.default_branch,
  };
  const errors = validateBlogConfiguration(configuration, repositoryContext);
  if (errors.length) {
    fail(errors.map((error) => `${error.path}: ${error.message}`).join("\n"));
  }

  const statePath = path.join(projectRoot, ".template", "state.json");
  const previousState = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : {};
  if (
    !previousState ||
    typeof previousState !== "object" ||
    Array.isArray(previousState) ||
    (existsSync(statePath) && previousState.schemaVersion !== 1)
  ) {
    fail(
      "The setup resource state is invalid. Restore it before reconfiguring.",
    );
  }
  const savedIssueNumber = previousState.resources?.noteContainer?.number;
  if (
    previousState.resources?.noteContainer &&
    !Number.isSafeInteger(savedIssueNumber)
  ) {
    fail(
      "The saved Note container identifier is invalid. Restore it before reconfiguring.",
    );
  }
  await ensureLabels(api, repository, configuration.writing);
  const noteContainer = await ensureNoteContainer(
    api,
    repository,
    configuration.writing.noteContainerTitle,
    configuration.writing.noteLabel,
    savedIssueNumber,
  );
  const pages = await readPagesStatus(
    api,
    repository,
    env.GITHUB_SERVER_URL ?? "https://github.com",
  );
  const state = {
    ...previousState,
    schemaVersion: 1,
    resources: {
      ...previousState.resources,
      noteContainer: {
        number: noteContainer.number,
        url: noteContainer.html_url,
        marker: noteContainerMarker,
      },
    },
  };
  mkdirSync(path.dirname(statePath), { recursive: true });
  mkdirSync(path.join(projectRoot, ".blog"), { recursive: true });
  writeJsonAtomically(
    path.join(projectRoot, ".blog", "config.json"),
    configuration,
  );
  writeJsonAtomically(statePath, state);
  writeWorkflowOutputs({
    publish_ready: String(pages.publishReady),
    theme_id: configuration.theme.id,
  }, env);
  writeStepSummary({ repository, configuration, noteContainer, pages }, env);

  stdout.write(
    `Validated and saved settings for ${repository.owner}/${repository.name}.\n`,
  );
  stdout.write(
    `Writing resources are ready. Pages publication ${pages.publishReady ? "is ready" : "needs a one-time GitHub Pages setting"}.\n`,
  );
  return { repository, noteContainer, pages };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  configureBlog().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function recordDeployment({
  env = process.env,
  projectRoot = process.cwd(),
  stdout = process.stdout,
} = {}) {
  const sourceKind = env.SOURCE_KIND;
  const sourceId = env.SOURCE_ID;
  const snapshotSha256 = env.SNAPSHOT_SHA256;
  if (!new Set(["blog-issue", "note-comment"]).has(sourceKind)) {
    throw new Error("SOURCE_KIND is not a supported published source.");
  }
  if (!sourceId || !/^[0-9a-f]{64}$/.test(snapshotSha256 ?? "")) {
    throw new Error(
      "The deployed source and snapshot identifiers are incomplete.",
    );
  }

  const statePath = path.join(projectRoot, ".template", "state.json");
  if (!existsSync(statePath)) {
    throw new Error(
      "The setup resource state is missing; run configuration first.",
    );
  }
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.deployments ??= {};
  state.deployments.publishedSnapshots ??= {};
  state.deployments.publishedSnapshots[`${sourceKind}:${sourceId}`] =
    snapshotSha256;
  state.deployments.lastPublished = {
    source: { kind: sourceKind, id: sourceId },
    snapshotSha256,
    articleUrl: env.ARTICLE_URL,
    runId: env.GITHUB_RUN_ID,
  };

  const contents = `${JSON.stringify(state, null, 2)}\n`;
  const temporaryPath = `${statePath}.tmp`;
  writeFileSync(temporaryPath, contents, { mode: 0o600 });
  renameSync(temporaryPath, statePath);
  stdout.write("Recorded the deployed publication snapshot.\n");
  return state;
}

export { recordDeployment };

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    recordDeployment();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

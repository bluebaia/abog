import { validateBlogConfiguration } from "../scripts/blog-config.mjs";

const $ = (selector) => document.querySelector(selector);
const form = $("#settings-form");
const repositoryInput = $("#repository-url");
const repositoryStatus = $("#repository-status");
const siteUrlInput = $("#site-url");
const customDomainInput = $("#custom-domain");
const defaultBranchInput = $("#default-branch");
const preview = $("#config-preview");
const previewState = $("#preview-state");
const errorsPanel = $("#field-errors");
const validationSummary = $("#validation-summary");
const copyButton = $("#copy-config");
const workflowLink = $("#open-workflow");
const importWorkflowLink = $("#import-workflow");
const existingConfigRow = $("#existing-config-row");

const state = { repository: null, validConfig: null };

const defaultShareLinks = [
  { name: "whatsapp", url: "https://wa.me/?text=" },
  { name: "facebook", url: "https://www.facebook.com/sharer.php?u=" },
  { name: "x", url: "https://x.com/intent/post?url=" },
  { name: "telegram", url: "https://t.me/share/url?url=" },
  { name: "pinterest", url: "https://pinterest.com/pin/create/button/?url=" },
  { name: "mail", url: "mailto:?subject=See%20this%20post&body=" },
];

function parseRepository(value) {
  const input = value.trim();
  let parts;
  if (/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(input)) {
    parts = input.split("/");
  } else {
    let url;
    try {
      url = new URL(input);
    } catch {
      throw new Error(
        "Paste a GitHub repository URL, such as https://github.com/name/blog.",
      );
    }
    if (url.hostname.toLowerCase() !== "github.com") {
      throw new Error("The repository address must use github.com.");
    }
    parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 2) parts[1] = parts[1].replace(/\.git$/i, "");
    if (
      parts.length !== 2 ||
      !/^[A-Za-z0-9-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9._-]+$/.test(parts[1])
    ) {
      throw new Error(
        "Use the repository address only, without an issue or file path.",
      );
    }
  }
  return { owner: parts[0], name: parts[1] };
}

function inferredSiteUrl(repository) {
  const ownerHost = `${repository.owner.toLowerCase()}.github.io`;
  if (repository.name.toLowerCase() === ownerHost)
    return `https://${ownerHost}/`;
  return `https://${ownerHost}/${repository.name}/`;
}

function setRepositoryStatus(message, kind = "neutral") {
  repositoryStatus.textContent = message;
  repositoryStatus.dataset.kind = kind;
}

function setStatus(message, kind = "neutral") {
  validationSummary.textContent = message;
  validationSummary.dataset.kind = kind;
}

function apiUrl(repository, path) {
  return `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}${path}`;
}

async function readPublicRepository(repository) {
  const response = await fetch(apiUrl(repository, ""), {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    if (response.status === 404)
      throw new Error(
        "GitHub could not find this public repository. Check the address and visibility.",
      );
    throw new Error(
      `GitHub could not check this repository (HTTP ${response.status}). Try again shortly.`,
    );
  }
  const details = await response.json();
  if (details.visibility !== "public") {
    throw new Error(
      "This template publishes a public blog, so the repository must be public.",
    );
  }
  if (!details.default_branch)
    throw new Error(
      "GitHub did not return a default branch for this repository.",
    );
  return details;
}

function fillRepositoryDefaults(details) {
  state.repository = {
    owner: details.owner.login,
    name: details.name,
    defaultBranch: details.default_branch,
  };
  defaultBranchInput.value = details.default_branch;
  if (!customDomainInput.checked || !siteUrlInput.value)
    siteUrlInput.value = inferredSiteUrl(state.repository);
  if (!$("#author").dataset.edited) $("#author").value = details.owner.login;
  if (!$("#site-title").dataset.edited) $("#site-title").value = details.name;
  if (!$("#home-description").dataset.edited)
    $("#home-description").value = `Welcome to ${details.name}.`;
  importWorkflowLink.href =
    "https://github.com/" +
    encodeURIComponent(details.owner.login) +
    "/" +
    encodeURIComponent(details.name) +
    "/actions/workflows/import-blog-content.yml";
  existingConfigRow.hidden = false;
  workflowLink.href = `https://github.com/${encodeURIComponent(details.owner.login)}/${encodeURIComponent(details.name)}/actions/workflows/configure-blog.yml`;
  workflowLink.classList.remove("is-disabled");
  workflowLink.removeAttribute("aria-disabled");
  setRepositoryStatus(
    `Public repository found. Default branch: ${details.default_branch}.`,
    "success",
  );
}

async function inspectRepository() {
  const button = $("#inspect-repository");
  button.disabled = true;
  setRepositoryStatus("Checking the public repository…");
  state.repository = null;
  existingConfigRow.hidden = true;
  workflowLink.classList.add("is-disabled");
  workflowLink.setAttribute("aria-disabled", "true");
  try {
    const repository = parseRepository(repositoryInput.value);
    const details = await readPublicRepository(repository);
    fillRepositoryDefaults(details);
  } catch (error) {
    setRepositoryStatus(error.message, "error");
  } finally {
    button.disabled = false;
    renderConfiguration();
  }
}

function collectSocialLinks() {
  return [...$("#social-links").querySelectorAll(".social-row")]
    .map((row) => ({
      name: row.querySelector("[data-social-name]").value.trim(),
      url: row.querySelector("[data-social-url]").value.trim(),
    }))
    .filter((link) => link.name || link.url);
}

function currentThemeId() {
  return form.elements.theme.value;
}

function createConfiguration() {
  if (!state.repository) return null;
  const profile = $("#profile").value.trim();
  return {
    schemaVersion: 1,
    repository: { ...state.repository },
    writing: {
      noteLabel: $("#note-label").value.trim(),
      blogLabel: $("#blog-label").value.trim(),
      noteContainerTitle: $("#note-title").value.trim(),
    },
    theme: {
      id: currentThemeId(),
      options: { "astro-paper": {}, "astro-cactus": {} },
    },
    site: {
      url: siteUrlInput.value.trim(),
      title: $("#site-title").value.trim(),
      description: $("#site-description").value.trim(),
      author: $("#author").value.trim(),
      ...(profile ? { profile } : {}),
      ogImage: $("#og-image").value.trim(),
      lang: $("#language").value,
      timezone: $("#timezone").value.trim(),
      dir: "ltr",
    },
    home: {
      title: $("#site-title").value.trim(),
      description: $("#home-description").value.trim(),
      readmeUrl: `https://github.com/${state.repository.owner}/${state.repository.name}`,
    },
    posts: {
      perPage: Number($("#per-page").value),
      perIndex: Number($("#per-page").value),
      scheduledPostMargin: 900000,
    },
    features: {
      lightAndDarkMode: $("#dark-mode").checked,
      dynamicOgImage: $("#dynamic-og").checked,
      showArchives: $("#show-archives").checked,
      showBackButton: $("#show-back-button").checked,
      editPost: { enabled: false },
      search: $("#search").value === "false" ? false : "pagefind",
    },
    socials: collectSocialLinks(),
    shareLinks: defaultShareLinks,
  };
}

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function renderCode(configuration) {
  const lines = JSON.stringify(configuration, null, 2).split("\n");
  preview.innerHTML = lines
    .map(
      (line, index) =>
        `<span class="code-line"><span class="line-number" aria-hidden="true">${index + 1}</span><span>${escapeHtml(line)}</span></span>`,
    )
    .join("\n");
}

function renderErrors(errors) {
  errorsPanel.replaceChildren();
  if (!errors.length) return;
  const title = document.createElement("p");
  title.className = "error-title";
  title.textContent = "Fix these settings before copying:";
  const list = document.createElement("ul");
  for (const error of errors) {
    const item = document.createElement("li");
    item.textContent = `${error.path}: ${error.message}`;
    list.append(item);
  }
  errorsPanel.append(title, list);
}

function renderConfiguration() {
  const configuration = createConfiguration();
  if (!configuration) {
    preview.innerHTML =
      '<span class="line-number" aria-hidden="true">1</span> Enter repository details to prepare your file.';
    previewState.textContent = "Waiting for repository";
    copyButton.disabled = true;
    state.validConfig = null;
    setStatus("Enter a public repository address to begin.");
    renderErrors([]);
    return;
  }

  renderCode(configuration);
  const errors = validateBlogConfiguration(configuration, state.repository);
  renderErrors(errors);
  if (errors.length) {
    previewState.textContent = "Needs attention";
    previewState.dataset.kind = "error";
    copyButton.disabled = true;
    state.validConfig = null;
    setStatus(
      `${errors.length} setting${errors.length === 1 ? " needs" : "s need"} attention. Fix the marked details to continue.`,
      "error",
    );
  } else {
    previewState.textContent = "Ready to hand off";
    previewState.dataset.kind = "success";
    copyButton.disabled = false;
    state.validConfig = configuration;
    setStatus(
      "Settings look good. Copy them, then run the GitHub setup task.",
      "success",
    );
  }
}

function addSocialRow(link = {}) {
  const row = document.createElement("div");
  row.className = "social-row";
  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "github";
  name.setAttribute("aria-label", "Social link icon name");
  name.dataset.socialName = "";
  name.value = link.name ?? "";
  const url = document.createElement("input");
  url.type = "url";
  url.placeholder = "https://github.com/your-name";
  url.setAttribute("aria-label", "Social link address");
  url.dataset.socialUrl = "";
  url.value = link.url ?? "";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-link";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    row.remove();
    renderConfiguration();
  });
  name.addEventListener("input", renderConfiguration);
  url.addEventListener("input", renderConfiguration);
  row.append(name, url, remove);
  $("#social-links").append(row);
}

function decodeBase64Utf8(value) {
  const bytes = Uint8Array.from(atob(value.replace(/\s/g, "")), (character) =>
    character.charCodeAt(0),
  );
  return new TextDecoder().decode(bytes);
}

async function loadExistingConfiguration() {
  if (!state.repository) return;
  const button = $("#load-existing");
  button.disabled = true;
  button.textContent = "Loading…";
  try {
    const { owner, name, defaultBranch } = state.repository;
    const response = await fetch(
      apiUrl(
        state.repository,
        `/contents/.blog/config.json?ref=${encodeURIComponent(defaultBranch)}`,
      ),
      {
        headers: { Accept: "application/vnd.github+json" },
      },
    );
    if (response.status === 404)
      throw new Error(
        "No settings file exists on the default branch yet. Run the setup task once first.",
      );
    if (!response.ok)
      throw new Error(
        `GitHub could not load settings (HTTP ${response.status}).`,
      );
    const file = await response.json();
    const configuration = JSON.parse(decodeBase64Utf8(file.content));
    if (
      configuration.repository?.owner?.toLowerCase() !== owner.toLowerCase() ||
      configuration.repository?.name?.toLowerCase() !== name.toLowerCase()
    ) {
      throw new Error(
        "The saved settings refer to another repository. The setup task will reject this mismatch.",
      );
    }
    applyConfiguration(configuration);
    setRepositoryStatus(
      `Loaded the settings from ${defaultBranch}.`,
      "success",
    );
    renderConfiguration();
  } catch (error) {
    setRepositoryStatus(error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Load existing settings";
  }
}

function applyConfiguration(configuration) {
  $("#site-url").value = configuration.site.url;
  $("#custom-domain").checked =
    !configuration.site.url.includes("github.io/") ||
    configuration.site.url.includes("github.io//");
  siteUrlInput.readOnly = !customDomainInput.checked;
  $("#site-title").value = configuration.site.title;
  $("#site-title").dataset.edited = "true";
  $("#author").value = configuration.site.author;
  $("#author").dataset.edited = "true";
  $("#site-description").value = configuration.site.description;
  $("#language").value = configuration.site.lang;
  $("#timezone").value = configuration.site.timezone;
  $("#profile").value = configuration.site.profile ?? "";
  $("#og-image").value = configuration.site.ogImage;
  $("#home-description").value = configuration.home.description;
  $("#home-description").dataset.edited = "true";
  $("#note-label").value = configuration.writing.noteLabel;
  $("#blog-label").value = configuration.writing.blogLabel;
  $("#note-title").value = configuration.writing.noteContainerTitle;
  $("#per-page").value = configuration.posts.perPage;
  $("#search").value =
    configuration.features.search === false ? "false" : "pagefind";
  $("#dark-mode").checked = configuration.features.lightAndDarkMode;
  $("#dynamic-og").checked = configuration.features.dynamicOgImage;
  $("#show-archives").checked = configuration.features.showArchives;
  $("#show-back-button").checked = configuration.features.showBackButton;
  for (const control of ["astro-paper", "astro-cactus"]) {
    const option = form.querySelector(
      `input[name="theme"][value="${control}"]`,
    );
    if (option && !option.disabled)
      option.checked = configuration.theme.id === control;
  }
  $("#social-links").replaceChildren();
  configuration.socials.forEach(addSocialRow);
}

async function copyConfiguration() {
  if (!state.validConfig) return;
  const value = JSON.stringify(state.validConfig, null, 2);
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const temporary = document.createElement("textarea");
    temporary.value = value;
    temporary.setAttribute("readonly", "");
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand("copy");
    temporary.remove();
    if (!copied) {
      setStatus(
        "Clipboard access was blocked. Select and copy the settings shown at right.",
        "error",
      );
      return;
    }
  }
  copyButton.textContent = "Copied settings";
  setStatus(
    "Copied. Open the GitHub setup task and paste into its configuration field.",
    "success",
  );
  window.setTimeout(() => {
    copyButton.textContent = "Copy settings for GitHub";
  }, 2200);
}

$("#inspect-repository").addEventListener("click", inspectRepository);
repositoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    inspectRepository();
  }
});
repositoryInput.addEventListener("change", () => {
  state.repository = null;
  renderConfiguration();
});
customDomainInput.addEventListener("change", () => {
  siteUrlInput.readOnly = !customDomainInput.checked;
  if (!customDomainInput.checked && state.repository)
    siteUrlInput.value = inferredSiteUrl(state.repository);
  renderConfiguration();
});
siteUrlInput.addEventListener("input", renderConfiguration);
form.addEventListener("input", (event) => {
  if (["siteTitle", "author", "homeDescription"].includes(event.target.name))
    event.target.dataset.edited = "true";
  renderConfiguration();
});
form.addEventListener("change", renderConfiguration);
$("#add-social").addEventListener("click", () => addSocialRow());
$("#load-existing").addEventListener("click", loadExistingConfiguration);
copyButton.addEventListener("click", copyConfiguration);

const queryRepository = new URLSearchParams(window.location.search).get("repo");
if (queryRepository) {
  repositoryInput.value = queryRepository;
  inspectRepository();
} else {
  renderConfiguration();
}

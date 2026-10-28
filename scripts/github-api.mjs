export function repositoryRoute(repository, suffix = "") {
  return `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}${suffix}`;
}

export function createGitHubApi({
  token,
  apiUrl = "https://api.github.com",
  fetchImplementation = fetch,
}) {
  if (!token)
    throw new Error("GITHUB_TOKEN is required for this repository task.");
  const baseUrl = apiUrl.replace(/\/+$/, "");
  return async (route, init = {}) => {
    const response = await fetchImplementation(
      route.startsWith("http") ? route : `${baseUrl}${route}`,
      {
        ...init,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...init.headers,
        },
      },
    );
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const message =
        response.status === 403
          ? "GitHub denied an API request. Check workflow permissions and repository organization policy."
          : details.message ||
            `GitHub API request failed with HTTP ${response.status}.`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return response;
  };
}

function nextPageUrl(response) {
  const linkHeader = response.headers.get("link");
  const nextLink = linkHeader
    ?.split(",")
    .find((link) => /rel="next"/.test(link));
  return nextLink?.match(/<([^>]+)>/)?.[1];
}

export async function listAllItems(api, route) {
  const items = [];
  let nextUrl = route;
  while (nextUrl) {
    const response = await api(nextUrl);
    items.push(...(await response.json()));
    nextUrl = nextPageUrl(response);
  }
  return items;
}

export async function getRepositoryDetails(api, repository) {
  const response = await api(repositoryRoute(repository));
  const details = await response.json();
  if (details.visibility !== "public") {
    throw new Error("This template only supports public blog repositories.");
  }
  return details;
}

export async function readPagesStatus(
  api,
  repository,
  webUrl = "https://github.com",
) {
  const settingsUrl = `${webUrl}/${repository.owner}/${repository.name}/settings/pages`;
  try {
    const response = await api(repositoryRoute(repository, "/pages"));
    const pages = await response.json();
    return {
      publishReady: pages.build_type === "workflow",
      pageUrl: pages.html_url ?? "",
      settingsUrl,
    };
  } catch (error) {
    if (error.status === 404) {
      return { publishReady: false, pageUrl: "", settingsUrl };
    }
    throw error;
  }
}

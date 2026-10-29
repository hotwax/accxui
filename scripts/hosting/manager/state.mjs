export const STATE_BRANCH = "app-hosting-state";
export async function readState(api, repo, file) {
  const data = await api(
    "GET",
    `/repos/${repo}/contents/${file}?ref=${STATE_BRANCH}`,
  );
  if (data.type !== "file" || data.encoding !== "base64")
    throw Error("Invalid operation state");
  return {
    sha: data.sha,
    value: JSON.parse(Buffer.from(data.content, "base64").toString("utf8")),
  };
}
export async function writeState(api, repo, file, value) {
  let ref;
  try {
    ref = await api("GET", `/repos/${repo}/git/ref/heads/${STATE_BRANCH}`);
  } catch (e) {
    if (e.status !== 404) throw e;
    const metadata = await api("GET", `/repos/${repo}`);
    const head = await api(
      "GET",
      `/repos/${repo}/git/ref/heads/${encodeURIComponent(metadata.default_branch)}`,
    );
    try {
      ref = await api("POST", `/repos/${repo}/git/refs`, {
        ref: `refs/heads/${STATE_BRANCH}`,
        sha: head.object.sha,
      });
    } catch (error) {
      if (error.status !== 422) throw error;
    }
  }
  let sha;
  try {
    sha = (await readState(api, repo, file)).sha;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  return api("PUT", `/repos/${repo}/contents/${file}`, {
    message: `Update hosting ${file}`,
    branch: STATE_BRANCH,
    content: Buffer.from(JSON.stringify(value, null, 2) + "\n").toString(
      "base64",
    ),
    ...(sha ? { sha } : {}),
  });
}
export async function readPlanBlob(api, repo, sha) {
  if (!/^[a-f0-9]{40}$/.test(sha || ""))
    throw Error("Review a valid immutable plan first");
  const blob = await api("GET", `/repos/${repo}/git/blobs/${sha}`);
  if (blob.encoding !== "base64") throw Error("Invalid plan encoding");
  return JSON.parse(Buffer.from(blob.content, "base64").toString("utf8"));
}

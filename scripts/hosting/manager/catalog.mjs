export function resolveTarget(rc, environment) {
  if (!["uat", "prod"].includes(environment))
    throw new Error("Choose UAT or Production.");
  const matches = Object.entries(rc.targets || {}).flatMap(
    ([project, targets]) =>
      (targets.hosting?.[environment] || []).map((site) => ({ project, site })),
  );
  if (matches.length !== 1 || !/^[a-z0-9-]+$/.test(matches[0].site))
    throw new Error(
      `Expected one ${environment} Hosting target in the app repository.`,
    );
  return {
    ...matches[0],
    environment,
    origin: `https://${matches[0].site}.web.app`,
  };
}

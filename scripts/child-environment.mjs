const inheritedNames = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "CI",
  "TERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "PLAYWRIGHT_BROWSERS_PATH",
  "XDG_CACHE_HOME",
];

export const createReleaseChildEnvironment = (source, additions = {}) => {
  const environment = {};
  for (const name of inheritedNames) {
    if (typeof source[name] === "string") environment[name] = source[name];
  }
  for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) {
    if (typeof source[name] === "string") environment[name] = source[name];
  }
  return { ...environment, ...additions };
};

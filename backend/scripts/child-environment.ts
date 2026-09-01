const SAFE_INHERITED_VARIABLES = [
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
] as const;

export const createChildEnvironment = (
  source: NodeJS.ProcessEnv,
  additions: Record<string, string> = {},
) => {
  const environment: Record<string, string> = {};
  for (const name of SAFE_INHERITED_VARIABLES) {
    const value = source[name];
    if (value !== undefined) environment[name] = value;
  }
  return { ...environment, ...additions };
};

export const __test = { SAFE_INHERITED_VARIABLES };

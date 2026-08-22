export const BASELINE_ENV_NAMES = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "COMSPEC",
  "HOME",
  "USERPROFILE",
  "TMP",
  "TEMP",
] as const;

export function buildChildEnv(input: {
  declared: string[];
  envValues?: Record<string, string>;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of BASELINE_ENV_NAMES) {
    const value = process.env[name];
    if (typeof value === "string" && value.length > 0) {
      env[name] = value;
    }
  }

  const envValues = input.envValues ?? {};
  for (const rawName of input.declared) {
    const name = rawName.trim();
    if (name.length === 0) {
      throw new Error("env");
    }
    if (name.startsWith("FLINTLOOM_")) {
      throw new Error("env");
    }
    const value = envValues[name] ?? process.env[name];
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`missing env: ${name}`);
    }
    env[name] = value;
  }

  return env;
}

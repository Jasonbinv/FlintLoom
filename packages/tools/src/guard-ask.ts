export class GuardAskError extends Error {
  readonly tool: string;

  constructor(tool: string) {
    super("guard ask");
    this.name = "GuardAskError";
    this.tool = tool;
  }
}

export function isGuardAskError(err: unknown): err is GuardAskError {
  return err instanceof GuardAskError;
}

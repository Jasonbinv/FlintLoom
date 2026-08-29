import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const ASSEMBLY = `plugins:
  - id: models
    name: "@flintloom/models"
  - id: tools
    name: "@flintloom/tools"
  - id: session
    name: "@flintloom/session"
  - id: models-chat
    name: "@flintloom/models-chat"
  - id: models-media
    name: "@flintloom/models-media"
  - id: models-guard
    name: "@flintloom/models-guard"
  - id: fs
    name: "@flintloom/fs"
  - id: grep
    name: "@flintloom/grep"
  - id: shell
    name: "@flintloom/shell"
  - id: web-search
    name: "@flintloom/web-search"
  - id: knowledge
    name: "@flintloom/knowledge"
  - id: docforge
    name: "@flintloom/docforge"
  - id: infographic
    name: "@flintloom/infographic/plugin"
  - id: a2ui
    name: "@flintloom/a2ui"
  - id: skill
    name: "@flintloom/skill"
  - id: loop
    name: "@flintloom/loop"
  - id: channel
    name: "@flintloom/channel"
  - id: channel-webhook
    name: "@flintloom/channel-webhook"
`;

export function writeAssembly(workspaceRoot: string): void {
  writeFileSync(join(workspaceRoot, "flintloom.yml"), ASSEMBLY);
}

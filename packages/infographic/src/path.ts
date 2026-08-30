function normalizedRelPath(relPath: string): string {
  return relPath.replaceAll("\\", "/").toLowerCase();
}

export function isInfographicRelPath(relPath: string): boolean {
  return normalizedRelPath(relPath).endsWith(".infographic.json");
}

export function isAntvInfographicRelPath(relPath: string): boolean {
  return normalizedRelPath(relPath).endsWith(".infographic.ig");
}

export function isAnyInfographicRelPath(relPath: string): boolean {
  return isInfographicRelPath(relPath) || isAntvInfographicRelPath(relPath);
}

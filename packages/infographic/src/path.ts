export function isInfographicRelPath(relPath: string): boolean {
  return relPath.replaceAll("\\", "/").toLowerCase().endsWith(".infographic.json");
}

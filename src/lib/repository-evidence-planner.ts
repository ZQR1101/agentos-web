import path from "node:path";

export function extractLocalImports(content: string) {
  return [...content.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith(".") || value.startsWith("@/"));
}

function resolveImport(fromFile: string, specifier: string, knownFiles: Set<string>) {
  const base = specifier.startsWith("@/")
    ? `src/${specifier.slice(2)}`
    : path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`]
    .find((candidate) => knownFiles.has(candidate));
}

export function selectInitialEvidence(files: string[], limit = 6) {
  const priority = /(^|\/)(layout|page|route|server|main|index)\.(tsx?|jsx?)$|(^|\/)(package\.json|next\.config\.(js|ts)|vite\.config\.(js|ts))$/;
  const candidates = files.filter((file) => priority.test(file));
  if (candidates.length < limit) candidates.push(...files.filter((file) => /\.[cm]?[jt]sx?$/.test(file) && !candidates.includes(file)));
  return candidates.slice(0, limit);
}

export function selectImportExpansion(repositoryFiles: string[], evidenceFiles: Array<{ path: string; content: string }>, limit = 4) {
  const knownFiles = new Set(repositoryFiles);
  const alreadyRead = new Set(evidenceFiles.map((file) => file.path));
  const resolved: string[] = [];
  for (const file of evidenceFiles) {
    for (const specifier of extractLocalImports(file.content)) {
      const target = resolveImport(file.path, specifier, knownFiles);
      if (target && !alreadyRead.has(target) && !resolved.includes(target)) resolved.push(target);
      if (resolved.length >= limit) return resolved;
    }
  }
  return resolved;
}

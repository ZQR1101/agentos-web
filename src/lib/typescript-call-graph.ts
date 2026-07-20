import ts from "typescript";
import path from "node:path";

export type CallGraphNode = { id: string; file: string; symbol: string; line: number };
export type CallGraphEdge = { from: string; to: string; file: string; line: number; confidence: "high" | "medium"; targetId?: string; targetFile?: string; targetLine?: number };
export type TypeScriptCallGraph = { nodes: CallGraphNode[]; edges: CallGraphEdge[] };

function lineOf(source: ts.SourceFile, node: ts.Node) { return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1; }
function symbolName(node: ts.FunctionLikeDeclarationBase) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (node.parent && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text;
  return undefined;
}
function calleeName(expression: ts.Expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

export function analyzeTypeScriptCallGraph(files: Array<{ path: string; content: string }>): TypeScriptCallGraph {
  const nodes: CallGraphNode[] = [];
  const rawEdges: Array<CallGraphEdge & { importSource?: string; importedSymbol?: string }> = [];
  const knownFiles = new Set(files.map((file) => file.path));
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file.path)) continue;
    const source = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true, file.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const imports = new Map<string, { source: string; imported: string }>();
    const visitFunction = (node: ts.Node, current?: CallGraphNode) => {
      let owner = current;
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
        const name = symbolName(node);
        if (name) { owner = { id: `${file.path}:${name}:${lineOf(source, node)}`, file: file.path, symbol: name, line: lineOf(source, node) }; nodes.push(owner); }
      }
      if (owner && ts.isCallExpression(node)) {
        const target = calleeName(node.expression);
        if (target && !["map", "filter", "find", "reduce", "join", "push", "slice", "then", "catch"].includes(target)) {
          const imported = imports.get(target);
          rawEdges.push({ from: owner.id, to: target, file: file.path, line: lineOf(source, node), confidence: ts.isIdentifier(node.expression) ? "high" : "medium", importSource: imported?.source, importedSymbol: imported?.imported });
        }
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) imports.set(element.name.text, { source: node.moduleSpecifier.text, imported: element.propertyName?.text ?? element.name.text });
      }
      ts.forEachChild(node, (child) => visitFunction(child, owner));
    };
    visitFunction(source);
  }
  const resolveModule = (from: string, specifier: string) => {
    const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` : specifier.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)) : undefined;
    if (!base) return undefined;
    return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => knownFiles.has(candidate));
  };
  const byFileAndSymbol = new Map(nodes.map((node) => [`${node.file}:${node.symbol}`, node]));
  const edges = rawEdges.map(({ importSource, importedSymbol, ...edge }) => {
    const targetFile = importSource ? resolveModule(edge.file, importSource) : edge.file;
    const target = targetFile ? byFileAndSymbol.get(`${targetFile}:${importedSymbol ?? edge.to}`) : undefined;
    return target ? { ...edge, to: target.symbol, targetId: target.id, targetFile: target.file, targetLine: target.line, confidence: "high" as const } : edge;
  });
  return { nodes: nodes.slice(0, 80), edges: edges.slice(0, 80) };
}

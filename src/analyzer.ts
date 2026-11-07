import { parser } from '@lezer/python';
import type { SyntaxNode } from '@lezer/common';

export interface ShapeAnnotation { dtype: string; arrayType: string; shape: string; from: number; to: number }
export interface ParameterInfo { name: string; label: string; from: number; to: number; shapes: ShapeAnnotation[] }
export interface AnnotatedSymbol {
  kind: 'function' | 'parameter' | 'variable'; name: string; from: number; to: number;
  nameFrom: number; nameTo: number; annotation?: string; signature?: string;
  parameters?: ParameterInfo[]; parameterLabels?: string[]; returnAnnotation?: string;
  shapes: ShapeAnnotation[];
}
export interface CallContext { calleeFrom: number; calleeTo: number; activeParameter: number; keyword?: string }
export interface DiagnosticInfo { from: number; to: number; message: string; code: string }
export interface Analysis {
  symbols: AnnotatedSymbol[]; diagnostics: DiagnosticInfo[];
  symbolAt(offset: number): AnnotatedSymbol | undefined;
  callAt(offset: number): CallContext | undefined;
}

interface Token { value: string; from: number; to: number; kind: 'name' | 'string' | 'op' }
interface Binding { from: number; symbol?: AnnotatedSymbol; dtype?: string; module?: boolean }
interface Scope {
  from: number; to: number; kind: 'module' | 'function' | 'class'; parent?: Scope;
  bindings: Map<string, Binding[]>;
}

const DTYPES = new Set([
  'Shaped', 'Bool', 'Num', 'Inexact', 'Float', 'BFloat16', 'Float16', 'Float32', 'Float64',
  'Complex', 'Complex64', 'Complex128', 'Integer', 'UInt', 'UInt2', 'UInt4', 'UInt8', 'UInt16',
  'UInt32', 'UInt64', 'Int', 'Int2', 'Int4', 'Int8', 'Int16', 'Int32', 'Int64', 'Real',
]);

// This lexer is only used to split annotations and argument lists. Python syntax,
// statement boundaries, and scopes come from Lezer's error-tolerant Python parser.
function lex(source: string, start = 0, end = source.length): Token[] {
  const out: Token[] = [];
  let i = start;
  while (i < end) {
    const c = source[i];
    if (/\s/u.test(c)) { i++; continue; }
    if (c === '#') { while (i < end && source[i] !== '\n') i++; continue; }
    const from = i;
    const prefix = source.slice(i, end).match(/^(?:[rRuUbBfF]{0,2})(?=['"])/)?.[0];
    if (prefix !== undefined) {
      i += prefix.length;
      const quote = source[i];
      const triple = source.slice(i, i + 3) === quote.repeat(3);
      const delimiter = quote.repeat(triple ? 3 : 1);
      i += delimiter.length;
      while (i < end) {
        if (source[i] === '\\') { i = Math.min(i + 2, end); continue; }
        if (source.slice(i, i + delimiter.length) === delimiter) { i += delimiter.length; break; }
        if (!triple && source[i] === '\n') break;
        i++;
      }
      out.push({ value: source.slice(from, i), from, to: i, kind: 'string' });
    } else if (/[\p{ID_Start}_]/u.test(c)) {
      i++;
      while (i < end && /[\p{ID_Continue}_]/u.test(source[i])) i++;
      out.push({ value: source.slice(from, i), from, to: i, kind: 'name' });
    } else {
      const pair = source.slice(i, i + 2);
      i += ['->', '**', ':=', '==', '!=', '<=', '>=', '//'].includes(pair) ? 2 : 1;
      out.push({ value: source.slice(from, i), from, to: i, kind: 'op' });
    }
  }
  return out;
}

function matching(tokens: Token[], at: number): number {
  const stack: string[] = [];
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  for (let i = at; i < tokens.length; i++) {
    const value = tokens[i].value;
    if (pairs[value]) stack.push(pairs[value]);
    else if ([')', ']', '}'].includes(value)) {
      if (value !== stack.pop()) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}

function split(tokens: Token[], separator = ','): Token[][] {
  const result: Token[][] = [];
  let segment: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (depth === 0 && token.value === separator) { result.push(segment); segment = []; continue; }
    segment.push(token);
    if (['(', '[', '{'].includes(token.value)) depth++;
    if ([')', ']', '}'].includes(token.value)) depth--;
  }
  result.push(segment);
  return result;
}

function topLevel(tokens: Token[], value: string): number {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (depth === 0 && tokens[i].value === value) return i;
    if (['(', '[', '{'].includes(tokens[i].value)) depth++;
    if ([')', ']', '}'].includes(tokens[i].value)) depth--;
  }
  return -1;
}

function normalize(source: string, tokens: Token[]): string {
  if (!tokens.length) return '';
  let out = tokens[0].value;
  for (let i = 1; i < tokens.length; i++) {
    const gap = source.slice(tokens[i - 1].to, tokens[i].from);
    out += (gap ? ' ' : '') + tokens[i].value;
  }
  return out;
}

function literal(token: Token): string | undefined {
  const match = token.value.match(/^([rRuU]*)("""|'''|"|')([\s\S]*)$/);
  if (!match || !match[3].endsWith(match[2])) return undefined;
  const body = match[3].slice(0, -match[2].length);
  if (/r/i.test(match[1])) return body;
  return body.replace(/\\(?:\r?\n|[\\'"abfnrtv]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3})/g, value => {
    const escape = value.slice(1);
    const basic: Record<string, string> = { '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\n': '', '\r\n': '' };
    if (escape in basic) return basic[escape];
    const n = /^[xuU]/.test(escape) ? parseInt(escape.slice(1), 16) : parseInt(escape, 8);
    return n <= 0x10ffff ? String.fromCodePoint(n) : value;
  });
}

function children(node: SyntaxNode): SyntaxNode[] {
  const result: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) result.push(child);
  return result;
}

function bind(scope: Scope, name: string, binding: Binding): void {
  const list = scope.bindings.get(name) ?? [];
  list.push(binding);
  scope.bindings.set(name, list);
}

function lookup(scope: Scope | undefined, name: string, offset: number): Binding | undefined {
  while (scope) {
    const list = scope.bindings.get(name);
    if (list?.length) {
      const before = list.filter(binding => binding.from <= offset);
      return before.at(-1) ?? list[0];
    }
    scope = scope.parent;
    // A method cannot access its class namespace with a bare name.
    if (scope?.kind === 'class') scope = scope.parent;
  }
  return undefined;
}

function collectShapes(source: string, tokens: Token[], scope: Scope, depth = 0, lookupOffset?: number): ShapeAnnotation[] {
  if (depth > 8) return [];
  const out: ShapeAnnotation[] = [];
  // Quoted forward annotations are parsed as text; no eval or Python process.
  if (tokens.length === 1 && tokens[0].kind === 'string') {
    const inner = literal(tokens[0]);
    if (inner === undefined) return [];
    return collectShapes(inner, lex(inner), scope, depth + 1, lookupOffset ?? tokens[0].from).map(shape => ({ ...shape, from: tokens[0].from, to: tokens[0].to }));
  }
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== 'name') continue;
    if (tokens[i - 1]?.value === '.') continue;
    let dtype: string | undefined;
    let open = i + 1;
    const binding = lookup(scope, token.value, lookupOffset ?? token.from);
    if (binding?.dtype) dtype = binding.dtype;
    if (binding?.module && tokens[i + 1]?.value === '.' && DTYPES.has(tokens[i + 2]?.value)) {
      dtype = tokens[i + 2].value;
      open = i + 3;
    }
    if (!dtype || tokens[open]?.value !== '[') continue;
    const end = matching(tokens, open);
    if (end < 0) continue;
    const parts = split(tokens.slice(open + 1, end));
    if (parts.length === 2 && parts[0].length && parts[1].length && parts[1].every(part => part.kind === 'string')) {
      const fragments = parts[1].map(literal);
      if (fragments.every(fragment => fragment !== undefined)) {
        out.push({ dtype, arrayType: normalize(source, parts[0]), shape: fragments.join(''), from: token.from, to: tokens[end].to });
      }
    }
  }
  return out;
}

/** Analyze source only. This function never imports or evaluates the Python file. */
export function analyze(source: string): Analysis {
  const tree = parser.parse(source);
  const tokens = lex(source);
  const symbols: AnnotatedSymbol[] = [];
  const diagnostics: DiagnosticInfo[] = [];
  const module: Scope = { from: 0, to: source.length, kind: 'module', bindings: new Map() };
  const scopes: Scope[] = [module];
  const pending: Array<{ symbol: AnnotatedSymbol; tokens: Token[]; scope: Scope; parameter?: ParameterInfo }> = [];

  function text(node: SyntaxNode): string { return source.slice(node.from, node.to); }
  function makeSymbol(kind: AnnotatedSymbol['kind'], node: SyntaxNode, name: SyntaxNode | Token): AnnotatedSymbol {
    return { kind, name: source.slice(name.from, name.to), from: node.from, to: node.to, nameFrom: name.from, nameTo: name.to, shapes: [] };
  }
  function addTargets(node: SyntaxNode, scope: Scope): void {
    if (node.name === 'VariableName') {
      const name = text(node);
      const previous = scope.bindings.get(name)?.at(-1)?.symbol;
      bind(scope, name, { from: node.from, symbol: previous?.kind === 'variable' ? previous : undefined });
    } else if (['TupleExpression', 'ArrayExpression', 'ParenthesizedExpression'].includes(node.name)) {
      for (const child of children(node)) addTargets(child, scope);
    }
  }
  function imports(node: SyntaxNode, scope: Scope): void {
    const ts = lex(source, node.from, node.to);
    const from = ts[0]?.value === 'from';
    const importAt = ts.findIndex(token => token.value === 'import');
    if (importAt < 0) return;
    const moduleName = from ? ts.slice(1, importAt).map(token => token.value).join('') : '';
    let names = ts.slice(importAt + 1);
    if (names[0]?.value === '(') names = names.slice(1, names.at(-1)?.value === ')' ? -1 : undefined);
    for (const part of split(names)) {
      if (!part.length) continue;
      if (moduleName === 'jaxtyping' && part[0].value === '*') {
        for (const dtype of DTYPES) bind(scope, dtype, { from: node.from, dtype });
        continue;
      }
      const asAt = part.findIndex(token => token.value === 'as');
      const importedName = part.slice(0, asAt >= 0 ? asAt : undefined).map(token => token.value).join('');
      const local = asAt >= 0 ? part[asAt + 1] : part[0];
      if (!local) continue;
      bind(scope, local.value, {
        from: node.from,
        dtype: from && moduleName === 'jaxtyping' && DTYPES.has(importedName) ? importedName : undefined,
        module: !from && importedName === 'jaxtyping',
      });
    }
  }
  function visit(node: SyntaxNode, scope: Scope, depth = 0): void {
    // Editor buffers can contain arbitrary malformed or deeply nested text.
    // Skip pathological subtrees without losing other declarations in the file.
    if (depth > 256) return;
    const kids = children(node);
    if (node.name === 'ImportStatement') { imports(node, scope); return; }
    if (node.name === 'FunctionDefinition') {
      const name = kids.find(child => child.name === 'VariableName');
      const params = kids.find(child => child.name === 'ParamList');
      const body = kids.find(child => child.name === 'Body');
      if (!name || !params) return;
      const symbol = makeSymbol('function', node, name);
      symbols.push(symbol);
      bind(scope, symbol.name, { from: name.from, symbol });
      const inner: Scope = { from: body?.from ?? params.to, to: body?.to ?? node.to, kind: 'function', parent: scope, bindings: new Map() };
      scopes.push(inner);
      const paramTokens = lex(source, params.from + 1, source[params.to - 1] === ')' ? params.to - 1 : params.to);
      const labels: string[] = [];
      const parameters: ParameterInfo[] = [];
      for (const part of split(paramTokens)) {
        if (!part.length) continue;
        const label = normalize(source, part);
        labels.push(label);
        const nameToken = part.find(token => token.kind === 'name');
        if (!nameToken || ['/', '*'].includes(part[0].value) && part.length === 1) continue;
        const parameter: ParameterInfo = { name: nameToken.value, label, from: part[0].from, to: part.at(-1)!.to, shapes: [] };
        parameters.push(parameter);
        const paramSymbol: AnnotatedSymbol = { kind: 'parameter', name: nameToken.value, from: part[0].from, to: part.at(-1)!.to, nameFrom: nameToken.from, nameTo: nameToken.to, shapes: [] };
        const colon = topLevel(part, ':');
        const equal = topLevel(part, '=');
        if (colon >= 0) {
          const annotationTokens = part.slice(colon + 1, equal >= 0 ? equal : undefined);
          paramSymbol.annotation = normalize(source, annotationTokens);
          pending.push({ symbol: paramSymbol, tokens: annotationTokens, scope, parameter });
        }
        symbols.push(paramSymbol);
        bind(inner, paramSymbol.name, { from: nameToken.from, symbol: paramSymbol });
      }
      symbol.parameters = parameters;
      symbol.parameterLabels = labels;
      const returns = kids.find(child => child.name === 'TypeDef');
      let returnText = '';
      if (returns) {
        const returnTokens = lex(source, returns.from, returns.to).slice(1);
        returnText = normalize(source, returnTokens);
        symbol.returnAnnotation = returnText;
        pending.push({ symbol, tokens: returnTokens, scope });
      }
      const async = kids.some(child => child.name === 'async');
      symbol.signature = `${async ? 'async ' : ''}def ${symbol.name}(${labels.join(', ')})${returnText ? ` -> ${returnText}` : ''}`;
      if (body) visit(body, inner, depth + 1);
      return;
    }
    if (node.name === 'ClassDefinition') {
      const name = kids.find(child => child.name === 'VariableName');
      const body = kids.find(child => child.name === 'Body');
      if (name) bind(scope, text(name), { from: name.from });
      if (body) {
        const inner: Scope = { from: body.from, to: body.to, kind: 'class', parent: scope, bindings: new Map() };
        scopes.push(inner);
        visit(body, inner, depth + 1);
      }
      return;
    }
    if (node.name === 'LambdaExpression') {
      const params = kids.find(child => child.name === 'ParamList');
      const inner: Scope = { from: node.from, to: node.to, kind: 'function', parent: scope, bindings: new Map() };
      scopes.push(inner);
      if (params) for (const part of split(lex(source, params.from, params.to))) {
        const name = part.find(token => token.kind === 'name');
        if (name) bind(inner, name.value, { from: name.from });
      }
      for (const child of kids) if (child !== params) visit(child, inner, depth + 1);
      return;
    }
    if (['ArrayComprehensionExpression', 'DictionaryComprehensionExpression', 'SetComprehensionExpression', 'ComprehensionExpression'].includes(node.name)) {
      const inner: Scope = { from: node.from, to: node.to, kind: 'function', parent: scope, bindings: new Map() };
      scopes.push(inner);
      let target = false;
      for (const child of kids) {
        if (child.name === 'for') { target = true; continue; }
        if (child.name === 'in') { target = false; continue; }
        if (target) addTargets(child, inner);
      }
      for (const child of kids) visit(child, inner, depth + 1);
      return;
    }
    if (node.name === 'AssignStatement') {
      const type = kids.find(child => child.name === 'TypeDef');
      const name = kids[0]?.name === 'VariableName' ? kids[0] : undefined;
      if (type && name) {
        const annotationTokens = lex(source, type.from, type.to).slice(1);
        const symbol = makeSymbol('variable', node, name);
        symbol.annotation = normalize(source, annotationTokens);
        symbols.push(symbol);
        bind(scope, symbol.name, { from: name.from, symbol });
        pending.push({ symbol, tokens: annotationTokens, scope });
      } else {
        let targetStart = 0;
        for (let i = 0; i < kids.length; i++) if (kids[i].name === 'AssignOp') {
          for (const target of kids.slice(targetStart, i)) addTargets(target, scope);
          targetStart = i + 1;
        }
      }
    }
    if (node.name === 'UpdateStatement' && kids[0]) addTargets(kids[0], scope);
    if (node.name === 'ForStatement') {
      for (const child of kids) { if (child.name === 'in') break; addTargets(child, scope); }
    }
    if (['WithStatement', 'TryStatement'].includes(node.name)) {
      for (let i = 1; i < kids.length; i++) if (kids[i - 1].name === 'as') addTargets(kids[i], scope);
    }
    if (node.name === 'NamedExpression' || node.name === 'CapturePattern') {
      if (kids[0]) addTargets(kids[0], scope);
    }
    for (const child of kids) visit(child, scope, depth + 1);
  }
  visit(tree.topNode, module);
  for (const scope of scopes) for (const bindings of scope.bindings.values()) bindings.sort((a, b) => a.from - b.from);
  for (const item of pending) {
    item.symbol.shapes.push(...collectShapes(source, item.tokens, item.scope));
    if (item.parameter) item.parameter.shapes = item.symbol.shapes;
  }
  for (const symbol of symbols) if (symbol.kind === 'function') {
    symbol.shapes.unshift(...(symbol.parameters ?? []).flatMap(parameter => parameter.shapes));
  }
  const seen = new Set<string>();
  for (const symbol of symbols) for (const shape of symbol.shapes) {
    const key = `${shape.from}:${shape.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const variadics = shape.shape.trim().split(/\s+/).filter(axis => axis === '...' || /^[#?_]*\*/.test(axis));
    if (variadics.length > 1) diagnostics.push({ from: shape.from, to: shape.to, code: 'multiple-variadic-axes', message: 'A jaxtyping shape may contain only one variadic axis ("..." or "*name").' });
  }
  function scopeAt(offset: number): Scope {
    return scopes.filter(scope => scope.from <= offset && (offset < scope.to || offset === source.length && scope.to === source.length)).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0] ?? module;
  }
  function symbolAt(offset: number): AnnotatedSymbol | undefined {
    const token = tokens.find(token => token.from <= offset && offset < token.to) ?? tokens.find(token => token.to === offset);
    if (!token || token.kind !== 'name') return undefined;
    const declaration = symbols.find(symbol => symbol.nameFrom === token.from && symbol.nameTo === token.to);
    if (declaration) return declaration;
    const i = tokens.indexOf(token);
    const node = tree.resolveInner(Math.min(token.from + 1, token.to), -1);
    if (tokens[i - 1]?.value === '.' && node.parent?.name === 'MemberExpression') return undefined;
    // Avoid returning a local symbol for a keyword argument, import name, or
    // text in an annotation string, comment, or property expression.
    if (node.name !== 'VariableName') return undefined;
    if (node.parent?.name === 'ImportStatement') return undefined;
    if (node.parent?.name === 'ArgList' && tokens[i + 1]?.value === '=') return undefined;
    const symbol = lookup(scopeAt(token.from), token.value, token.from)?.symbol;
    return symbol?.shapes.length ? symbol : undefined;
  }
  function callAt(offset: number): CallContext | undefined {
    // Lezer recovers CallExpression/ArgList nodes even for unfinished calls.
    let node: SyntaxNode | null = tree.resolveInner(Math.max(0, Math.min(source.length, offset)), -1);
    while (node && node.name !== 'ArgList') node = node.parent;
    while (node) {
      if (node.name === 'ArgList' && node.parent?.name === 'CallExpression' && node.from < offset) {
        const callee = node.parent.firstChild;
        if (!callee) return undefined;
        if (source[node.to - 1] === ')' && offset >= node.to) return undefined;
        const commas = children(node).filter(child => child.name === ',' && child.from < offset);
        const segmentFrom = commas.at(-1)?.to ?? node.from + 1;
        const current = tokens.filter(token => token.from >= segmentFrom && token.from < offset && token.to <= offset);
        const keyword = current[0]?.kind === 'name' && current[1]?.value === '=' ? current[0].value : undefined;
        // Point at the terminal identifier so definition providers can resolve
        // module.function and self.method calls without guessing their receiver.
        const calleeTokens = lex(source, callee.from, callee.to);
        const name = calleeTokens.at(-1);
        if (!name || name.kind !== 'name') return undefined;
        return { calleeFrom: name.from, calleeTo: name.to, activeParameter: commas.length, keyword };
      }
      node = node.parent;
    }
    return undefined;
  }
  return { symbols, diagnostics, symbolAt, callAt };
}


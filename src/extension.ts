import * as vscode from 'vscode';
import { analyze, Analysis, AnnotatedSymbol } from './analyzer';
import { formatHover, formatSignature } from './presentation';

const MAX_DOCUMENT_LENGTH = 2_000_000;
const MAX_CACHE_ENTRIES = 32;
const selector: vscode.DocumentSelector = { language: 'python' };

/** A source reader, never a Python evaluator. Pylance owns type inference. */
export function activate(context: vscode.ExtensionContext) {
  const cache = new Map<string, { version: number; analysis: Analysis }>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const diagnostics = vscode.languages.createDiagnosticCollection('jaxtypinglint');
  const config = (document: vscode.TextDocument) =>
    vscode.workspace.getConfiguration('jaxtypinglint', document.uri);

  function analysisFor(document: vscode.TextDocument): Analysis | undefined {
    const key = document.uri.toString();
    const entry = cache.get(key);
    if (entry?.version === document.version) return entry.analysis;
    const source = document.getText();
    if (source.length > MAX_DOCUMENT_LENGTH) return undefined;
    let analysis: Analysis;
    try {
      analysis = analyze(source);
    } catch {
      // Never let malformed or excessively nested source break the editor's
      // event loop. Cache failure until the document changes, like successes.
      analysis = { symbols: [], diagnostics: [], symbolAt: () => undefined, callAt: () => undefined };
    }
    cache.delete(key);
    cache.set(key, { version: document.version, analysis });
    if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    return analysis;
  }

  async function resolveSymbol(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<AnnotatedSymbol | undefined> {
    const local = analysisFor(document)?.symbolAt(document.offsetAt(position));
    if (local?.shapes.length) return local;
    if (token.isCancellationRequested) return undefined;

    // Reuse the user's Python language server for imports and methods instead of
    // scanning the workspace or implementing a second Python name resolver.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    const cancellation = new Promise<undefined>((resolve) => {
      cancel = () => resolve(undefined);
      timeout = setTimeout(cancel, 1200);
    });
    const listener = token.onCancellationRequested(() => cancel?.());
    try {
      const definitions = await Promise.race([
        vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
          'vscode.executeDefinitionProvider', document.uri, position,
        ),
        cancellation,
      ]);
      if (token.isCancellationRequested) return undefined;
      for (const definition of definitions?.slice(0, 8) ?? []) {
        const uri = 'targetUri' in definition ? definition.targetUri : definition.uri;
        const range = 'targetUri' in definition
          ? definition.targetSelectionRange ?? definition.targetRange : definition.range;
        if (!['file', 'untitled', 'vscode-notebook-cell', 'vscode-remote'].includes(uri.scheme)) continue;
        const target = await vscode.workspace.openTextDocument(uri);
        if (token.isCancellationRequested) return undefined;
        if (target.languageId !== 'python') continue;
        const analysis = analysisFor(target);
        const from = target.offsetAt(range.start);
        const to = target.offsetAt(range.end);
        const symbol = analysis?.symbolAt(from) ?? analysis?.symbols.find(candidate =>
          candidate.nameFrom >= from && candidate.nameTo <= to);
        if (symbol?.shapes.length) return symbol;
      }
    } catch {
      // A missing language server or a disappearing file is a normal condition.
    } finally {
      if (timeout) clearTimeout(timeout);
      listener.dispose();
    }
    return undefined;
  }

  const hoverProvider: vscode.HoverProvider = {
    async provideHover(document, position, token) {
      if (!config(document).get<boolean>('enabled', true)) return undefined;
      const range = document.getWordRangeAtPosition(position);
      if (!range) return undefined;
      const symbol = await resolveSymbol(document, position, token);
      if (!symbol || token.isCancellationRequested) return undefined;
      const md = new vscode.MarkdownString(formatHover(symbol));
      md.isTrusted = false;
      if (!md.value) return undefined;
      return new vscode.Hover(md, range);
    },
  };

  const signatureProvider: vscode.SignatureHelpProvider = {
    async provideSignatureHelp(document, position, token) {
      if (!config(document).get<boolean>('enabled', true) ||
          !config(document).get<boolean>('signatureHelp', false)) return undefined;
      const call = analysisFor(document)?.callAt(document.offsetAt(position));
      if (!call) return undefined;
      const symbol = await resolveSymbol(document, document.positionAt(call.calleeFrom), token);
      if (symbol?.kind !== 'function' || !symbol.signature || token.isCancellationRequested) return undefined;
      // Source alone cannot reliably distinguish a bound method from a call via
      // its class. Let the Python language server handle receiver binding.
      if (['self', 'cls'].includes(symbol.parameters?.[0]?.name ?? '')) return undefined;
      const compact = formatSignature(symbol);
      const signature = new vscode.SignatureInformation(compact.label);
      signature.parameters = compact.parameters.map(param => {
        const docs = param.documentation ? new vscode.MarkdownString(param.documentation) : undefined;
        if (docs) docs.isTrusted = false;
        return new vscode.ParameterInformation(param.label, docs);
      });
      const help = new vscode.SignatureHelp();
      help.signatures = [signature];
      help.activeSignature = 0;
      const keywordIndex = call.keyword
        ? symbol.parameters?.findIndex(param => param.name === call.keyword) ?? -1 : -1;
      help.activeParameter = Math.max(0, Math.min(
        keywordIndex >= 0 ? keywordIndex : call.activeParameter,
        signature.parameters.length - 1,
      ));
      return help;
    },
  };

  function updateDiagnostics(document: vscode.TextDocument) {
    if (document.isClosed || document.languageId !== 'python') return;
    if (!config(document).get<boolean>('enabled', true) ||
        !config(document).get<boolean>('diagnostics', true)) {
      diagnostics.delete(document.uri);
      return;
    }
    const items = analysisFor(document)?.diagnostics ?? [];
    diagnostics.set(document.uri, items.map(item => {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(document.positionAt(item.from), document.positionAt(item.to)),
        item.message, vscode.DiagnosticSeverity.Warning,
      );
      diagnostic.source = 'jaxtypinglint';
      diagnostic.code = item.code;
      return diagnostic;
    }));
  }

  context.subscriptions.push(
    diagnostics,
    vscode.languages.registerHoverProvider(selector, hoverProvider),
    vscode.languages.registerSignatureHelpProvider(selector, signatureProvider, '(', ',', '='),
    vscode.commands.registerCommand('jaxtypinglint.showShape', () =>
      vscode.commands.executeCommand('editor.action.showHover')),
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument(({ document }) => {
      if (document.languageId !== 'python') return;
      const key = document.uri.toString();
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => {
        timers.delete(key);
        updateDiagnostics(document);
      }, 200));
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      const key = document.uri.toString();
      clearTimeout(timers.get(key));
      timers.delete(key);
      cache.delete(key);
      diagnostics.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('jaxtypinglint'))
        vscode.workspace.textDocuments.forEach(updateDiagnostics);
    }),
    { dispose() { timers.forEach(clearTimeout); timers.clear(); cache.clear(); } },
  );
  vscode.workspace.textDocuments.forEach(updateDiagnostics);
}

export function deactivate() {}

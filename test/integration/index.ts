import assert from 'node:assert/strict';
import * as vscode from 'vscode';

const importHeader = 'from jaxtyping import Float, Bool\nfrom torch import Tensor\n';
const sample = `${importHeader}
def channel_mean(image: Float[Tensor, "batch channels height width"], mask: Bool[Tensor, "batch height width"] | None = None) -> Float[Tensor, "batch channels"]:
    return image

batch: Float[Tensor, "batch channels height width"]
result = channel_mean(batch)
`;

function position(document: vscode.TextDocument, needle: string, delta = 0, last = false): vscode.Position {
  const offset = last ? document.getText().lastIndexOf(needle) : document.getText().indexOf(needle);
  assert.ok(offset >= 0, `Missing test marker ${needle}`);
  return document.positionAt(offset + delta);
}

function markdownText(value: string | vscode.MarkdownString | undefined): string {
  return typeof value === 'string' ? value : value?.value ?? '';
}

async function open(source: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({ language: 'python', content: source });
  await vscode.window.showTextDocument(document);
  return document;
}

async function hover(document: vscode.TextDocument, at: vscode.Position): Promise<string> {
  const result = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', document.uri, at);
  return (result ?? []).flatMap(item => item.contents.map(content => typeof content === 'string' ? content : content.value)).join('\n');
}

async function eventually<T>(get: () => T | PromiseLike<T>, accept: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 5000;
  do {
    const value = await get();
    if (accept(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}`);
}

async function configure(key: string, value: unknown): Promise<void> {
  await vscode.workspace.getConfiguration('jaxtypinglint').update(key, value, vscode.ConfigurationTarget.Workspace);
}

export async function run(): Promise<void> {
  assert.ok(process.env.JAXTYPINGLINT_EXTENSION_ID, 'The runner supplies the manifest extension ID');
  const extension = vscode.extensions.getExtension(process.env.JAXTYPINGLINT_EXTENSION_ID);
  assert.ok(extension, 'Extension is available in the actual VS Code extension host');
  await extension.activate();
  await configure('enabled', true);
  await configure('diagnostics', true);
  await configure('signatureHelp', false);
  let passed = 0;
  const check = async (name: string, test: () => Promise<void>) => {
    await test();
    passed++;
    console.log(`PASS: ${name}`);
  };

  try {
    const document = await open(sample);

    await check('function hover separates compact input shapes from the return annotation', async () => {
      const text = await hover(document, position(document, 'channel_mean', 3));
      assert.match(text, /\*\*Shapes\*\*/);
      assert.match(text, /Parameter\s*\|\s*Shape\s*\|\s*Dtype/);
      assert.match(text, /batch channels height width/);
      assert.match(text, /batch channels/);
      assert.match(text, /Bool/);
      assert.match(text, /\*\*Returns\*\*/);
      assert.doesNotMatch(text, /def channel_mean|runtime shapes|Declared annotations/);
    });

    await check('call-site hover includes shapes without a second function signature', async () => {
      const text = await hover(document, position(document, 'channel_mean', 3, true));
      assert.match(text, /\|\s*`image`\s*\|/);
      assert.match(text, /batch channels height width/);
      assert.doesNotMatch(text, /channel_mean|mask:|= None/);
    });

    await check('shape hover coexists with another Python hover provider', async () => {
      const other = vscode.languages.registerHoverProvider({ language: 'python' }, {
        provideHover: () => new vscode.Hover(new vscode.MarkdownString().appendCodeblock(
          'def channel_mean(image: Tensor, mask: Tensor | None = None) -> Tensor', 'python',
        )),
      });
      try {
        const text = await hover(document, position(document, 'channel_mean', 3, true));
        assert.match(text, /image: Tensor/);
        assert.match(text, /batch channels height width/);
        assert.equal((text.match(/def channel_mean/g) ?? []).length, 1, 'Only the companion provider supplies the full signature');
      } finally {
        other.dispose();
      }
    });

    await check('parameter and variable hovers use a one-line shape summary', async () => {
      for (const at of [position(document, 'return image', 9), position(document, 'channel_mean(batch)', 14)]) {
        const text = await hover(document, at);
        assert.match(text, /\*\*Shape\*\*/);
        assert.match(text, /batch channels height width/);
        assert.match(text, /Float/);
        assert.doesNotMatch(text, /Tensor|image:|batch:|Parameter|```|runtime/);
        assert.equal(text.trim().split('\n').length, 1);
      }
    });

    await check('long signatures show only the four shaped parameters with no repeated boilerplate', async () => {
      const source = await open(`${importHeader}from typing import Literal

def compare_feature_batches(
    source_values_or_features: Float[Tensor, "batch_size ..."],
    current_feature_values: Float[Tensor, "batch_size seq_len"],
    comparison_method: Literal["none", "nearest", "exact"] = "none",
    previous_feature_values: Float[Tensor, "batch_size seq_len"] | None = None,
    threshold: float | None = None,
    feature_mask: Bool[Tensor, "batch_size seq_len"] | None = None,
) -> tuple[Tensor, dict[str, Tensor]]:
    ...

compare_feature_batches(features, )
`);
      const text = await hover(source, position(source, 'compare_feature_batches', 3, true));
      const names = ['source_values_or_features', 'current_feature_values', 'previous_feature_values', 'feature_mask'];
      let previous = -1;
      for (const name of names) {
        assert.equal(text.split(name).length - 1, 1, `One row for ${name}`);
        const current = text.indexOf(name);
        assert.ok(current > previous, 'Rows retain source parameter order');
        previous = current;
      }
      assert.doesNotMatch(text, /compare_feature_batches|comparison_method|threshold|Literal|Tensor|None|Returns|runtime|Declared/);
      assert.ok(text.length < 600, 'Shape-only content remains compact for a long signature');
    });

    await check('nested return annotations retain their structure rather than inventing output positions', async () => {
      const source = await open(`${importHeader}
def split_features() -> tuple[Float[Tensor, "batch"], dict[str, Bool[Tensor, "batch tokens"]]] | None:
    ...

split_features()
`);
      const text = await hover(source, position(source, 'split_features', 3, true));
      assert.match(text, /\*\*Returns\*\*/);
      assert.match(text, /tuple\[Float\[Tensor, "batch"\], dict\[str, Bool\[Tensor, "batch tokens"\]\]\] \| None/);
      assert.doesNotMatch(text, /Parameter|split_features|return\[\d+\]/);
    });

    await check('hover still works while an unfinished call is being typed', async () => {
      const incomplete = await open(sample + '\nchannel_mean(\n');
      assert.match(await hover(incomplete, position(incomplete, 'channel_mean', 3, true)), /batch channels height width/);
    });

    await check('hover reflects unsaved edits instead of stale cached shapes', async () => {
      const edited = await open(`${importHeader}values: Float[Tensor, "old_axis"]\nvalues\n`);
      assert.match(await hover(edited, position(edited, 'values', 2, true)), /old_axis/);
      const edit = new vscode.WorkspaceEdit();
      const start = position(edited, 'old_axis');
      edit.replace(edited.uri, new vscode.Range(start, start.translate(0, 'old_axis'.length)), 'new_axis');
      assert.ok(await vscode.workspace.applyEdit(edit));
      const text = await hover(edited, position(edited, 'values', 2, true));
      assert.match(text, /new_axis/);
      assert.doesNotMatch(text, /old_axis/);
    });

    await check('imported function hover uses another definition provider', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(folder);
      const target = vscode.Uri.joinPath(folder.uri, 'external_shapes.py');
      const targetSource = `${importHeader}def crop(image: Float[Tensor, "height width channels"]) -> Float[Tensor, "crop_h crop_w channels"]:\n    return image\n`;
      await vscode.workspace.fs.writeFile(target, Buffer.from(targetSource));
      const targetDocument = await vscode.workspace.openTextDocument(target);
      const source = await open('from external_shapes import crop\ncrop(frame)\n');
      let definitionRequests = 0;
      let mode: 'name' | 'declaration' | 'link' = 'name';
      const definition = vscode.languages.registerDefinitionProvider({ language: 'python' }, {
        provideDefinition(doc) {
          if (doc.uri.toString() !== source.uri.toString()) return undefined;
          definitionRequests++;
          const at = position(targetDocument, 'crop');
          const declaration = new vscode.Range(position(targetDocument, 'def crop'), targetDocument.positionAt(targetSource.length));
          if (mode === 'declaration') return new vscode.Location(target, declaration);
          if (mode === 'link') return [{ targetUri: target, targetRange: declaration }];
          return new vscode.Location(target, new vscode.Range(at, at.translate(0, 4)));
        },
      });
      try {
        for (const format of ['name', 'declaration', 'link'] as const) {
          mode = format;
          const text = await hover(source, position(source, 'crop', 2, true));
          assert.match(text, /crop_h crop_w channels/, `Resolves ${format} definition ranges`);
        }
        assert.equal(definitionRequests, 3, 'Each definition lookup was actually used');
      } finally {
        definition.dispose();
      }
    });

    await check('broad definition ranges do not leak nested function shapes', async () => {
      const target = await open(`${importHeader}def outer():\n    def inner(x: Float[Tensor, "nested_only"]):\n        return x\n    return inner\n`);
      const source = await open('from elsewhere import outer\nouter()\n');
      const provider = vscode.languages.registerDefinitionProvider({ language: 'python' }, {
        provideDefinition(doc) {
          if (doc.uri.toString() !== source.uri.toString()) return undefined;
          return new vscode.Location(target.uri, new vscode.Range(
            position(target, 'def outer'), target.positionAt(target.getText().length),
          ));
        },
      });
      try {
        assert.doesNotMatch(await hover(source, position(source, 'outer', 2, true)), /nested_only|\*\*Shapes\*\*/);
      } finally { provider.dispose(); }
    });

    await check('multiple variadic axes get a diagnostic that can be disabled', async () => {
      const bad = await open(`${importHeader}bad: Float[Tensor, "*batch ... channels"]\n`);
      const ours = () => vscode.languages.getDiagnostics(bad.uri).filter(item => item.source === 'jaxtypinglint');
      const found = await eventually(ours, items => items.length > 0, 'shape diagnostic');
      assert.match(found[0].message, /variadic|multiple|more than one/i);
      await configure('diagnostics', false);
      await eventually(ours, items => items.length === 0, 'diagnostics to be cleared');
      await configure('diagnostics', true);
    });

    await check('signature help is opt-in and shows the active shape without repeating annotations', async () => {
      const call = await open(sample + '\nchannel_mean(batch, ');
      const at = call.positionAt(call.getText().length);
      const before = await vscode.commands.executeCommand<vscode.SignatureHelp>('vscode.executeSignatureHelpProvider', call.uri, at);
      assert.ok(!before || before.signatures.length === 0, 'Signature help is off by default');
      await configure('signatureHelp', true);
      const signature = await eventually(
        () => vscode.commands.executeCommand<vscode.SignatureHelp>('vscode.executeSignatureHelpProvider', call.uri, at),
        result => !!result && result.signatures.length > 0,
        'opt-in signature provider',
      );
      assert.ok(signature);
      const info = signature.signatures[0];
      assert.match(info.label, /^channel_mean\(image, mask\s*=\s*…\)$/);
      assert.doesNotMatch(info.label, /Float|Bool|Tensor|batch|None|def |->/);
      assert.equal(markdownText(info.documentation), '', 'Signature-level prose does not duplicate parameter shape docs');
      assert.equal(signature.activeParameter, 1);
      assert.match(markdownText(info.parameters[signature.activeParameter].documentation), /batch height width/);
      assert.doesNotMatch(markdownText(info.parameters[signature.activeParameter].documentation), /batch channels height width|Tensor|runtime/);
      await configure('signatureHelp', false);
    });

    await check('method hovers preserve shapes while signatures defer binding to Pylance', async () => {
      await configure('signatureHelp', true);
      try {
        for (const receiver of ['self', 'cls']) {
          const target = await open(`${importHeader}\nclass Resizer:\n    def resize(${receiver}, image: Float[Tensor, "height width channels"], size: int) -> Float[Tensor, "new_h new_w channels"]:\n        return image\n`);
          // An unrelated same-name function must not supply the member's hover or signature.
          const call = await open(`${importHeader}\ndef resize(image: Float[Tensor, "wrong_local_shape"]):\n    return image\n\nresizer.resize(frame, `);
          let definitionRequests = 0;
          const definition = vscode.languages.registerDefinitionProvider({ language: 'python' }, {
            provideDefinition(doc) {
              if (doc.uri.toString() !== call.uri.toString()) return undefined;
              definitionRequests++;
              const at = position(target, 'resize');
              return new vscode.Location(target.uri, new vscode.Range(at, at.translate(0, 6)));
            },
          });
          try {
            const text = await hover(call, position(call, 'resize', 2, true));
            assert.match(text, /new_h new_w channels/);
            assert.doesNotMatch(text, /wrong_local_shape/);
            const signature = await vscode.commands.executeCommand<vscode.SignatureHelp>(
              'vscode.executeSignatureHelpProvider', call.uri, call.positionAt(call.getText().length),
            );
            assert.ok(!signature || signature.signatures.length === 0, `No misleading ${receiver} argument index`);
            assert.ok(definitionRequests >= 2, 'Both hover and signature resolved the method declaration');
          } finally {
            definition.dispose();
          }
        }
      } finally {
        await configure('signatureHelp', false);
      }
    });

    await check('enabled setting suppresses extension hover', async () => {
      await configure('enabled', false);
      await eventually(
        () => hover(document, position(document, 'channel_mean', 3)),
        text => !/\*\*Shapes\*\*/.test(text),
        'disabled hover',
      );
      await configure('enabled', true);
    });

    console.log(`\n${passed} extension-host integration checks passed.`);
  } finally {
    await configure('enabled', undefined);
    await configure('diagnostics', undefined);
    await configure('signatureHelp', undefined);
    // The host is disposable. Closing unsaved test documents would show save prompts.
  }
}

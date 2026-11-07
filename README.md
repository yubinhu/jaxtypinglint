# jaxtypinglint

See your jaxtyping shape annotations in VS Code, alongside Pylance. Works with
PyTorch, NumPy, JAX, or any other annotated array type. **No Python interpreter,
JAX installation, or code execution is required.**

Given an annotation such as:

```python
from jaxtyping import Float
from torch import Tensor

def resize(image: Float[Tensor, "batch channels height width"]) -> Float[Tensor, "batch channels out_h out_w"]:
    ...

resize(image)
```

Hover over `resize` at the call or declaration to see a compact **Shapes** table.
Only shape-annotated parameters appear. The extension omits the full signature,
base array types, defaults, and explanatory boilerplate already covered by Pylance.
A shared dtype appears once in the heading; mixed dtypes get their own column.

For example:

**Shapes** · `Float`

| Parameter | Shape |
| :--- | :--- |
| `image` | `batch channels height width` |

Hovering an annotated parameter or variable produces just one line:

**Shape** `batch channels height width` · `Float`

An empty shape is labeled *scalar*. Return annotations with shapes appear under
**Returns**, preserving tuple, container, and union structure. Unannotated return
types add nothing to this section. Pylance continues to provide its usual
completions, type checking, and documentation.

## Install

1. Download `jaxtypinglint-0.2.0.vsix` from the [GitHub release](https://github.com/yubinhu/jaxtypinglint/releases/latest).
2. In VS Code, open Extensions and choose **… → Install from VSIX…**.
3. Select the downloaded file, then open a Python file and hover over an annotated
   function call, parameter, or variable. If needed, run **Developer: Reload Window**.

Marketplace publication is pending a publisher account. The GitHub VSIX works
without a Marketplace listing.

Or run the VS Code CLI from the directory containing the downloaded file:

```sh
code --install-extension ./jaxtypinglint-0.2.0.vsix
```

Keep Pylance enabled. Try `examples/demo.py` without installing any Python
packages; the extension reads source only. The examples are editor fixtures,
not runnable programs. You can also place the cursor over a name and run
**jaxtypinglint: Show Shape Annotation** from the Command Palette.

## Optional signatures while typing

Hover sections from different extensions combine. Signature help providers are
selected by VS Code rather than merged, so shape-aware signature help is opt-in:

```json
{
  "jaxtypinglint.signatureHelp": true
}
```

After enabling it, type a call or use **Trigger Parameter Hints** (`⌘⇧Space` on
macOS). The signature shows parameter names and `= …` for defaults; the active
parameter's shape and dtype appear below. This avoids repeating every type and
shape while you fill in one argument. Positional-only `/`, keyword-only `*`, and
variadic parameters are preserved. Provider selection can vary with other
installed extensions; hover is the dependable way to see both Pylance's output
and the declared shapes.

## Scope

- Reads `Float`, `Int`, `Bool`, `Shaped`, and other jaxtyping dtype annotations.
- Supports `from jaxtyping import Float as F` and `import jaxtyping as jt`.
- Preserves shape strings, including variadic axes, broadcasting modifiers,
  symbolic expressions, and scalar shapes.
- Shows annotations in unions, optional parameters, and nested return types.
- Uses a tolerant Python syntax parser, so unfinished calls don't require a
  syntactically valid file.
- Resolves local declarations directly. For imports and methods, it asks an
  existing Python definition provider (such as Pylance) for the source location.
- Warns when one shape contains multiple variadic axes, a jaxtyping constraint.

This extension displays **declared shapes**. It does not infer the shape of
intermediate tensors, check tensor operations, or prove argument compatibility.
Pylance's existing `Tensor` signature remains visible; this adds a separate
section instead of patching Pylance. Dynamically constructed annotations and
arbitrary type-alias expansion are outside this initial version. Cross-file
support needs a definition provider that can locate the annotated source.
For signatures with an initial `self` or `cls`, signature help is left to the
Python language server; source alone cannot determine whether the receiver is bound.
Documents larger than two million characters are skipped to keep editing responsive.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| `jaxtypinglint.enabled` | `true` | Enable hover, signature help, and diagnostics. |
| `jaxtypinglint.signatureHelp` | `false` | Compact signatures with the active parameter’s shape. |
| `jaxtypinglint.diagnostics` | `true` | Warn about multiple variadic axes. |

## Develop locally

Use Node.js 22 LTS or newer and npm. No Python packages are needed.

```sh
npm ci
npm run typecheck
npm test
npm run build
```

Open this repository in VS Code and press **F5**. The launch configuration builds
the extension and opens a separate Extension Development Host with the examples.
Edit the extension, rebuild, and reload that window to try changes. To rebuild
automatically, use `npm run watch` in another terminal.

```sh
npm run test:integration
npm run package
```

Integration tests run in a real VS Code extension host with an isolated profile.
On macOS the runner uses `/Applications/Visual Studio Code.app` if present.
Otherwise `@vscode/test-electron` downloads VS Code. Set `VSCODE_EXECUTABLE_PATH`
to test a specific installation. These tests open a temporary editor window;
headless Linux requires a display, for example `xvfb-run -a npm run test:integration`.
They exercise the actual hover, diagnostic, and signature APIs, including a
simulated external definition provider. They do not claim Pylance end-to-end
coverage. The test host disables other installed extensions.

`npm run package` creates a bundled VSIX; users do not need Node.js or npm to
install it. The publisher ID `jaxtypinglint-local` is for local packaging only.
Nothing is published to the Marketplace by these commands. See [PUBLISHING.md](PUBLISHING.md)
for the remaining Marketplace setup and release steps.

## Implementation

`src/analyzer.ts` uses the error-tolerant [Lezer Python parser](https://github.com/lezer-parser/python)
to read annotation source. `src/presentation.ts` formats compact Markdown and signature labels.
`src/extension.ts` connects that analysis to VS Code's
hover, signature, and diagnostic APIs. Parsing results are cached by document
version, with debounced diagnostics and a bounded cache. The extension never
imports a Python module, runs a shell command, scans the entire workspace, or
sends source code to a service.

References: [jaxtyping array annotations](https://docs.kidger.site/jaxtyping/api/array/),
[jaxtyping static typing FAQ](https://docs.kidger.site/jaxtyping/faq/), and
[VS Code language features](https://code.visualstudio.com/api/language-extensions/programmatic-language-features).

## License

MIT. Bundled dependency licenses are included in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, AnnotatedSymbol } from '../src/analyzer';
import { formatHover, formatParameterShapes, formatSignature } from '../src/presentation';

interface MarkdownToken { type: string; content: string; children?: MarkdownToken[] }
const MarkdownIt = require('markdown-it') as new () => {
  render(markdown: string): string;
  parse(markdown: string, env: object): MarkdownToken[];
};
const markdown = new MarkdownIt();

const prelude = 'from jaxtyping import Float, Bool, Int, Shaped\nfrom torch import Tensor\n';
function symbol(source: string, name = 'sample'): AnnotatedSymbol {
  const result = analyze(prelude + source).symbols.find(item => item.name === name);
  assert.ok(result, `Expected declaration for ${name}`);
  return result;
}

test('function hover contains only shaped parameters and a single shared dtype', () => {
  const hover = formatHover(symbol(`def sample(
    extremely_long_observation_name: Float[Tensor, "batch_size ..."],
    values: Float[Tensor, "batch_size seq_len"],
    method: Literal["none", "clip"] = "none",
    old_values: Float[Tensor, "batch_size seq_len"] | None = None,
    scale: float = 0.5,
) -> tuple[Tensor, dict[str, Tensor]]:
    pass\n`));
  assert.match(hover, /^\*\*Shapes\*\* · `Float`/);
  assert.match(hover, /\| Parameter \| Shape \|/);
  assert.match(hover, /\| `extremely_long_observation_name` \| `batch_size \.\.\.` \|/);
  assert.equal((hover.match(/`Float`/g) ?? []).length, 1);
  assert.equal(hover.split('\n').filter(line => /^\| `/.test(line)).length, 3);
  assert.doesNotMatch(hover, /def |sample\(|Tensor|method|scale|Literal|None|Returns|runtime/);
});

test('mixed dtype parameters have a labeled dtype column', () => {
  const hover = formatHover(symbol('def sample(values: Float[Tensor, "batch"], mask: Bool[Tensor, "batch"]):\n    pass\n'));
  assert.match(hover, /\| Parameter \| Shape \| Dtype \|/);
  assert.match(hover, /\| `values` \| `batch` \| `Float` \|/);
  assert.match(hover, /\| `mask` \| `batch` \| `Bool` \|/);
});

test('a variable and parameter show a one-line shape without its declaration', () => {
  const variable = symbol('value: Float[Tensor, "batch channels"]\n', 'value');
  assert.equal(formatHover(variable), '**Shape** `batch channels` · `Float`');
  const parameter = symbol('def sample(value: Float[Tensor, "batch channels"]):\n    return value\n', 'value');
  assert.equal(formatHover(parameter), formatHover(variable));
});

test('scalar is explicit while shape syntax remains intact', () => {
  assert.equal(formatHover(symbol('value: Float[Tensor, ""]\n', 'value')), '**Shape** *scalar* · `Float`');
  const hover = formatHover(symbol('value: Shaped[Tensor, "#batch *features dim-1 rows=3"]\n', 'value'));
  assert.equal(hover, '**Shape** `#batch *features dim-1 rows=3` · `Shaped`');
});

test('nested return structure is retained separately instead of inventing tuple positions', () => {
  const annotation = 'tuple[Float[Tensor, "batch"], dict[str, Bool[Tensor, "batch seq"]]] | None';
  const hover = formatHover(symbol(`def sample(value: Float[Tensor, "batch seq"]) -> ${annotation}:\n    pass\n`));
  assert.ok(hover.endsWith(`**Returns**\n\n\`${annotation}\``));
  assert.doesNotMatch(hover, /return\[0\]|return\[1\]|&#124;|\\\| None/);
});

test('return-only shapes do not introduce an empty parameter table', () => {
  const hover = formatHover(symbol('def sample(count: int) -> Float[Tensor, "count channels"]:\n    pass\n'));
  assert.equal(hover, '**Returns**\n\n`Float[Tensor, "count channels"]`');
});

test('exact repeated annotations are shown once per parameter but shared shape keeps parameter identities', () => {
  const hover = formatHover(symbol('def sample(a: Float[Tensor, "batch"] | Float[Tensor, "batch"], b: Float[Tensor, "batch"]):\n    pass\n'));
  const rows = hover.split('\n').filter(line => /^\| `/.test(line));
  assert.deepEqual(rows, ['| `a` | `batch` |', '| `b` | `batch` |']);
});

test('different array backends do not duplicate identical visible shape summaries', () => {
  const declaration = symbol('def sample(value: Float[Tensor, "batch"] | Float[np.ndarray, "batch"]):\n    pass\n');
  assert.deepEqual(formatHover(declaration).split('\n').filter(line => /^\| `/.test(line)), ['| `value` | `batch` |']);
  assert.equal(formatParameterShapes(declaration.parameters![0].shapes), '**Shape** `batch` · `Float`');
});

test('pipes are escaped for table cells but preserved in one-line shape summaries', () => {
  const declaration = symbol('def sample(value: Float[Tensor, "left|right"]):\n    pass\n');
  assert.match(formatHover(declaration), /`left\\\|right`/);
  assert.equal(formatParameterShapes(declaration.parameters![0].shapes), '**Shape** `left|right` · `Float`');
});

test('shape backticks HTML and newlines stay inside a single inert table cell', () => {
  const declaration = symbol('def sample(value: Float[Tensor, "`<img src=x> | a\\nb`"]):\n    pass\n');
  const hover = formatHover(declaration);
  assert.match(hover, /`` `<img src=x> \\\| a b` ``/);
  assert.equal(hover.split('\n').filter(line => /^\| `/.test(line)).length, 1);
  assert.doesNotMatch(hover, /&#124;|```/);
});

test('compact signatures preserve positional and keyword separators and exact highlight offsets', () => {
  const declaration = symbol('def sample(a: Float[Tensor, "batch"], /, b: int = 3, *, mask: Bool[Tensor, "batch"] | None = None, **kwargs):\n    pass\n');
  const result = formatSignature(declaration);
  assert.equal(result.label, 'sample(a, /, b = …, *, mask = …, **kwargs)');
  assert.deepEqual(result.parameters.map(parameter => result.label.slice(...parameter.label)), ['a', 'b = …', 'mask = …', '**kwargs']);
  assert.equal(result.parameters[0].documentation, '**Shape** `batch` · `Float`');
  assert.equal(result.parameters[1].documentation, '');
  assert.equal(result.parameters[2].documentation, '**Shape** `batch` · `Bool`');
  assert.doesNotMatch(result.label, /Tensor|Float|Bool|None|batch|def /);
});

test('equals signs inside annotation strings do not create spurious default markers', () => {
  const result = formatSignature(symbol(`def sample(
    required: Float[Tensor, "rows=3 cols=4"],
    literal: Literal["=", "->"],
    forward: 'Float[Tensor, "x=4"]',
    optional: Float[Tensor, "batch"] = make_tensor("=", {"key": 3}),
    text: str = "a,b=c",
):
    pass\n`));
  assert.equal(result.label, 'sample(required, literal, forward, optional = …, text = …)');
  assert.deepEqual(result.parameters.map(parameter => result.label.slice(...parameter.label)), ['required', 'literal', 'forward', 'optional = …', 'text = …']);
});

test('variadic argument spelling survives compact signature formatting', () => {
  const result = formatSignature(symbol('def sample(*values: Float[Tensor, "batch"], scale: float = 1.0, **metadata):\n    pass\n'));
  assert.equal(result.label, 'sample(*values, scale = …, **metadata)');
  assert.deepEqual(result.parameters.map(parameter => result.label.slice(...parameter.label)), ['*values', 'scale = …', '**metadata']);
});

test('rendered table cells preserve special characters without Markdown or HTML injection', () => {
  for (const shape of [
    'left|right', 'left\\|right', '`tick`', '``tick``|width',
    '<img src=x onerror=alert(1)>', '[open](command:untrusted)', 'a\nb',
  ]) {
    const source = `def sample(value: Float[Tensor, ${JSON.stringify(shape)}]):\n    pass\n`;
    const hover = formatHover(symbol(source));
    const html = markdown.render(hover);
    assert.equal((html.match(/<td(?:\s|>)/g) ?? []).length, 2, shape);
    assert.doesNotMatch(html, /<(?:img|script|a\s)/, shape);
    const inlineCode = markdown.parse(hover, {}).flatMap(token => token.children ?? [])
      .filter(token => token.type === 'code_inline').map(token => token.content);
    assert.ok(inlineCode.includes(shape.replace(/\n/g, ' ')), `${JSON.stringify(shape)} renders verbatim: ${inlineCode}`);
  }
});

test('rendered return annotation preserves readable union syntax', () => {
  const annotation = 'tuple[Float[Tensor, "batch"], Bool[Tensor, ""]] | None';
  const hover = formatHover(symbol(`def sample() -> ${annotation}:\n    pass\n`));
  const inlineCode = markdown.parse(hover, {}).flatMap(token => token.children ?? [])
    .filter(token => token.type === 'code_inline').map(token => token.content);
  assert.deepEqual(inlineCode, [annotation]);
  assert.doesNotMatch(markdown.render(hover), /&amp;#124;|\\\|/);
});

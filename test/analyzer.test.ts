import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/analyzer';

const prelude = 'from jaxtyping import Float, Int, Bool, Shaped\nfrom torch import Tensor\n';
function atMarked(text: string) {
  const offset = text.indexOf('¦');
  assert.notEqual(offset, -1);
  const source = text.replace('¦', '');
  return { source, offset, analysis: analyze(source) };
}

test('a preceding ellipsis body does not turn a later function call into an attribute', () => {
  const { offset, analysis } = atMarked(prelude + `
def sample(values: Float[Tensor, "batch channels"]):
    ...

sam¦ple(values)
`);
  assert.equal(analysis.symbolAt(offset)?.name, 'sample');
  assert.equal(analysis.symbolAt(offset)?.shapes[0].shape, 'batch channels');
});

test('function hovers retain all annotations, unions, defaults and tuple returns', () => {
  const { source, offset, analysis } = atMarked(prelude + `
def score(
    values: Float[Tensor, "batch_size ..."],
    mask: Bool[Tensor, "batch_size seq_len"] | None = None,
    *,
    threshold: float = 0.5,
) -> tuple[Float[Tensor, "batch_size"], dict[str, Int[Tensor, ""]]]:
    return values
sc¦ore(values, mask)
`);
  const symbol = analysis.symbolAt(offset)!;
  assert.equal(symbol.kind, 'function');
  assert.deepEqual(symbol.shapes.map(s => s.shape), ['batch_size ...', 'batch_size seq_len', 'batch_size', '']);
  assert.match(symbol.signature!, /mask: Bool\[Tensor, "batch_size seq_len"\] \| None = None/);
  assert.match(symbol.signature!, /\*, threshold: float = 0.5/);
  assert.equal(source.slice(symbol.nameFrom, symbol.nameTo), 'score');
  assert.deepEqual(symbol.parameters!.map(p => p.name), ['values', 'mask', 'threshold']);
  for (const p of symbol.parameters!) assert.equal(p.label, source.slice(p.from, p.to));
});

test('annotated parameter and variable references resolve in their scope', () => {
  const { offset, analysis } = atMarked(prelude + `
def center(points: Float[Tensor, "batch xyz"]):
    result: Float[Tensor, "batch xyz"] = points
    return re¦sult
`);
  assert.equal(analysis.symbolAt(offset)?.kind, 'variable');
  assert.equal(analysis.symbolAt(offset)?.shapes[0].shape, 'batch xyz');
  const src = prelude + 'def f(points: Float[Tensor, "b c"]):\n    return points\n';
  assert.equal(analyze(src).symbolAt(src.lastIndexOf('points'))?.kind, 'parameter');
});

test('module aliases, imported dtype aliases and parenthesized imports', () => {
  const source = `import jaxtyping as jt
from jaxtyping import (
    Float as F,
    Bool as B,
)
def f(x: F[torch.Tensor, "batch channels"], y: jt.Int[Tensor, "batch"], z: B[Tensor, ""]):
    pass
`;
  assert.deepEqual(analyze(source).symbols[0].shapes.map(s => [s.dtype, s.arrayType, s.shape]), [
    ['Float', 'torch.Tensor', 'batch channels'], ['Int', 'Tensor', 'batch'], ['Bool', 'Tensor', ''],
  ]);
});

test('forward strings, raw strings, adjacent strings, escaped shapes and scalar shape', () => {
  const source = prelude + `
def f(x: 'Float[Tensor, "batch c"]', y: Float[Tensor, "batch " "c"], z: Shaped[Tensor, ""], q: Float[Tensor, r"#batch *features"]):
    pass
`;
  const symbol = analyze(source).symbols[0];
  assert.deepEqual(symbol.shapes.map(s => s.shape), ['batch c', 'batch c', '', '#batch *features']);
  assert.ok(symbol.shapes.every(s => s.from > 0 && s.to <= source.length));
});

test('module-qualified Float from an unrelated library is ignored', () => {
  const source = `from somewhere import Float
import someone as jt
def f(x: Float[Tensor, "b c"], y: jt.Float[Tensor, "b c"]): pass
`;
  assert.equal(analyze(source).symbols[0].shapes.length, 0);
  const unrelated = analyze(prelude + 'import jaxtyping as jt\nx: other.Float[Tensor, "b c"]\ny: other.jt.Float[Tensor, "b c"]');
  assert.ok(unrelated.symbols.every(symbol => symbol.shapes.length === 0));
});

test('strings and comments containing fake definitions create no shapes', () => {
  const source = prelude + `
# def fake(x: Float[Tensor, "x"]): ...
text = '''def fake(x: Float[Tensor, "x"]): ...'''
text2 = "Float[Tensor, 'b c']"
`;
  assert.equal(analyze(source).symbols.length, 0);
  assert.equal(analyze(source).symbolAt(source.indexOf('fake')), undefined);
});

test('unannotated local parameters shadow annotated names in outer scopes', () => {
  const { offset, analysis } = atMarked(prelude + `
x: Float[Tensor, "outer"]
def f(x):
    return ¦x
`);
  assert.equal(analysis.symbolAt(offset), undefined);
});

test('an unrelated attribute never resolves to a same-named function', () => {
  const { offset, analysis } = atMarked(prelude + `
def f(x: Float[Tensor, "b"]): pass
other.¦f(x)
`);
  assert.equal(analysis.symbolAt(offset), undefined);
});

test('same-name nested definitions resolve lexically', () => {
  const { source, offset, analysis } = atMarked(prelude + `
def f(x: Float[Tensor, "outer"]): pass
def wrap():
    def f(x: Float[Tensor, "inner"]): pass
    ¦f(x)
f(x)
`);
  assert.equal(analysis.symbolAt(offset)?.shapes[0].shape, 'inner');
  assert.equal(analysis.symbolAt(source.lastIndexOf('f(x)'))?.shapes[0].shape, 'outer');
});

test('function-local assignment shadows an outer function before assignment too', () => {
  const { offset, analysis } = atMarked(prelude + `
def f(x: Float[Tensor, "b"]): pass
def wrap():
    ¦f(x)
    f = other
`);
  assert.equal(analysis.symbolAt(offset), undefined);
});

test('module scope is restored immediately after a function body', () => {
  const { offset, analysis } = atMarked(prelude + `
x: Float[Tensor, "outer"]
def f(x: Float[Tensor, "inner"]):
    pass
¦x
`);
  assert.equal(analysis.symbolAt(offset)?.shapes[0].shape, 'outer');
});

test('dtype imports can be shadowed', () => {
  const source = prelude + `
Float = other
def f(x: Float[Tensor, "b"]): pass
`;
  assert.equal(analyze(source).symbols[0].shapes.length, 0);
});

test('keyword argument names do not resolve to same-named local variables', () => {
  const { offset, analysis } = atMarked(prelude + `
x: Float[Tensor, "b"]
f(¦x=anything)
`);
  assert.equal(analysis.symbolAt(offset), undefined);
});

test('reassignments retain an existing local annotation; lambda parameters shadow it', () => {
  const loop = atMarked(prelude + 'x: Float[Tensor, "b"]\nfor x in data:\n    print(¦x)\n');
  assert.equal(loop.analysis.symbolAt(loop.offset)?.shapes[0].shape, 'b');
  const lambda = atMarked(prelude + 'x: Float[Tensor, "b"]\ng = lambda x: ¦x\n');
  assert.equal(lambda.analysis.symbolAt(lambda.offset), undefined);
});

test('comprehension targets shadow outer annotations without leaking', () => {
  const source = prelude + 'x: Float[Tensor, "b"]\ny = [x for x in [1,2,3]]\nx\n';
  const analysis = analyze(source);
  assert.equal(analysis.symbolAt(source.indexOf('[x') + 1), undefined);
  assert.equal(analysis.symbolAt(source.indexOf('for x') + 4), undefined);
  assert.equal(analysis.symbolAt(source.lastIndexOf('x'))?.shapes[0].shape, 'b');
});

test('tuple assignments and augmented assignments shadow an outer function', () => {
  for (const statement of ['f, g = pair', 'f += other', 'for f in things: pass']) {
    const { offset, analysis } = atMarked(prelude + `def f(x: Float[Tensor, "b"]): pass\ndef wrap():\n    ${statement}\n    ¦f(x)\n`);
    assert.equal(analysis.symbolAt(offset), undefined, statement);
  }
});

test('incomplete function call retains the preceding signature', () => {
  const { source, offset, analysis } = atMarked(prelude + `
def f(x: Float[Tensor, "b c"], y: Bool[Tensor, "b"] | None = None): pass
f(x, ¦
`);
  const call = analysis.callAt(offset)!;
  assert.equal(source.slice(call.calleeFrom, call.calleeTo), 'f');
  assert.equal(call.activeParameter, 1);
  assert.equal(analysis.symbolAt(call.calleeFrom)?.kind, 'function');
});

test('nested commas, strings, keyword args and lambdas do not inflate argument index', () => {
  for (const prefix of ['f([1, 2], ', 'f("a,b", ', 'f(g(1, 2), ', 'f(lambda x, y: x + y, ']) {
    const { offset, analysis } = atMarked(prefix + 'keyword=¦');
    assert.equal(analysis.callAt(offset)?.activeParameter, 1, prefix);
    assert.equal(analysis.callAt(offset)?.keyword, 'keyword', prefix);
  }
});

test('signature help picks the innermost call', () => {
  const { source, offset, analysis } = atMarked('outer(x, inner(y, ¦))');
  const call = analysis.callAt(offset)!;
  assert.equal(source.slice(call.calleeFrom, call.calleeTo), 'inner');
  assert.equal(call.activeParameter, 1);
});

test('member call points to terminal name for external definition lookup', () => {
  const { source, offset, analysis } = atMarked('package.fn(x, ¦)');
  const call = analysis.callAt(offset)!;
  assert.equal(source.slice(call.calleeFrom, call.calleeTo), 'fn');
  assert.equal(analysis.symbolAt(call.calleeFrom), undefined);
});

test('signature help is absent in definitions and after closed calls', () => {
  for (const source of ['def f(x, ', 'class C(X, ', 'f(x)', 'a = [1, 2, ']) {
    assert.equal(analyze(source).callAt(source.length), undefined, source);
  }
});

test('only definitively invalid multiple variadic axes are diagnosed', () => {
  const source = prelude + `
def bad(x: Float[Tensor, "*batch ..."], y: Float[Tensor, "*a #*b"]): pass
def good(x: Float[Tensor, "dim*2 dim*3"], y: Float[Tensor, "#batch *features"], z: Float[Tensor, ""]): pass
`;
  const result = analyze(source);
  assert.equal(result.diagnostics.length, 2);
  assert.ok(result.diagnostics.every(d => d.code === 'multiple-variadic-axes'));
  assert.match(source.slice(result.diagnostics[0].from, result.diagnostics[0].to), /\*batch/);
});

test('async signatures, positional-only and variadic parameters are preserved', () => {
  const source = prelude + 'async def f(x: Float[Tensor, "b"], /, *args: Float[Tensor, "b"], **kwargs: Bool[Tensor, ""]): pass';
  const symbol = analyze(source).symbols[0];
  assert.match(symbol.signature!, /^async def f\(/);
  assert.deepEqual(symbol.parameters!.map(p => p.name), ['x', 'args', 'kwargs']);
  assert.equal(symbol.shapes.length, 3);
});

test('unterminated neighboring expressions do not crash or erase valid declarations', () => {
  const source = prelude + 'def f(x: Float[Tensor, "b c"]):\n    pass\n\nf(\n';
  assert.equal(analyze(source).symbols[0].shapes[0].shape, 'b c');
  for (const fragment of ['"', 'def f(', 'x: Float[', 'f(x=[', 'from jaxtyping import (']) {
    assert.doesNotThrow(() => analyze(prelude + fragment));
  }
});

test('pathologically deep syntax is skipped without crashing or hiding neighboring functions', () => {
  const source = prelude + 'x = ' + '('.repeat(2000) + '0' + ')'.repeat(2000) + '\ndef f(x: Float[Tensor, "b c"]): pass\n';
  const analysis = analyze(source);
  assert.equal(analysis.symbols.find(symbol => symbol.kind === 'function')?.shapes[0].shape, 'b c');
});

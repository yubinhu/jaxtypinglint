import type { AnnotatedSymbol, ParameterInfo, ShapeAnnotation } from './analyzer';

/** Render source as inert inline code, including inside Markdown table cells. */
function code(value: string, tableCell = false): string {
  const text = value.replace(/\r\n|[\n\r]/g, ' ');
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map(run => run.length));
  const fence = '`'.repeat(longest + 1);
  const padding = text.startsWith('`') || text.endsWith('`') || /^ .* $/.test(text) ? ' ' : '';
  return `${fence}${padding}${tableCell ? text.replace(/\|/g, '\\|') : text}${padding}${fence}`;
}

function shapeLabel(shape: ShapeAnnotation, tableCell = false): string {
  return shape.shape.trim() ? code(shape.shape, tableCell) : '*scalar*';
}

function uniqueShapes(shapes: ShapeAnnotation[]): ShapeAnnotation[] {
  const seen = new Set<string>();
  return shapes.filter(shape => {
    const key = JSON.stringify([shape.dtype, shape.shape]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Single variables and active arguments need no repeated declaration. */
export function formatParameterShapes(shapes: ShapeAnnotation[]): string {
  return uniqueShapes(shapes).map(shape =>
    `**Shape** ${shapeLabel(shape)} · ${code(shape.dtype)}`,
  ).join('  \n');
}

export function formatHover(symbol: AnnotatedSymbol): string {
  if (symbol.kind !== 'function') return formatParameterShapes(symbol.shapes);

  const sections: string[] = [];
  const parameters = (symbol.parameters ?? []).filter(parameter => parameter.shapes.length);
  if (parameters.length) {
    const dtypes = new Set(parameters.flatMap(parameter => parameter.shapes.map(shape => shape.dtype)));
    const sharedDtype = dtypes.size === 1 ? [...dtypes][0] : undefined;
    const rows = parameters.flatMap(parameter => uniqueShapes(parameter.shapes).map(shape =>
      `| ${code(parameter.name, true)} | ${shapeLabel(shape, true)} |${sharedDtype ? '' : ` ${code(shape.dtype, true)} |`}`,
    ));
    const heading = `**Shapes**${sharedDtype ? ` · ${code(sharedDtype)}` : ''}`;
    const columns = sharedDtype ? '| Parameter | Shape |\n| :--- | :--- |' : '| Parameter | Shape | Dtype |\n| :--- | :--- | :--- |';
    sections.push(`${heading}\n\n${columns}\n${rows.join('\n')}`);
  }

  // The analyzer prepends parameter shapes to the function's return shapes.
  // Keep nested return structure intact instead of inventing tuple/union paths.
  const parameterShapeCount = (symbol.parameters ?? []).reduce((sum, parameter) => sum + parameter.shapes.length, 0);
  if (symbol.shapes.length > parameterShapeCount && symbol.returnAnnotation) {
    sections.push(`**Returns**\n\n${code(symbol.returnAnnotation)}`);
  }
  return sections.join('\n\n');
}

/** A default marker outside strings and brackets; annotation literals may use =. */
function hasDefault(label: string): boolean {
  let depth = 0;
  for (let i = 0; i < label.length; i++) {
    const char = label[i];
    if (char === '"' || char === "'") {
      const quote = label.slice(i, i + 3) === char.repeat(3) ? char.repeat(3) : char;
      i += quote.length;
      while (i < label.length) {
        if (label[i] === '\\') { i += 2; continue; }
        if (label.slice(i, i + quote.length) === quote) { i += quote.length - 1; break; }
        i++;
      }
    } else if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (char === '=' && depth === 0) return true;
  }
  return false;
}

function parameterLabel(parameter: ParameterInfo): string {
  const prefix = parameter.label.trim().match(/^\*{1,2}/)?.[0] ?? '';
  return `${prefix}${parameter.name}${hasDefault(parameter.label) ? ' = …' : ''}`;
}

export interface CompactSignature {
  label: string;
  parameters: Array<{ label: [number, number]; documentation: string }>;
}

/** Show call structure once; only the selected argument's docs show its shapes. */
export function formatSignature(symbol: AnnotatedSymbol): CompactSignature {
  const parameters = symbol.parameters ?? [];
  const labels = symbol.parameterLabels ?? parameters.map(parameter => parameter.label);
  let label = `${symbol.name}(`;
  let index = 0;
  const result: CompactSignature['parameters'] = [];
  for (const original of labels) {
    if (!label.endsWith('(')) label += ', ';
    if (original === '/' || original === '*') { label += original; continue; }
    const parameter = parameters[index++];
    if (!parameter) continue;
    const from = label.length;
    label += parameterLabel(parameter);
    result.push({ label: [from, label.length], documentation: formatParameterShapes(parameter.shapes) });
  }
  label += ')';
  return { label, parameters: result };
}

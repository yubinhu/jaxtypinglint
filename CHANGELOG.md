# Changelog

## 0.2.1

- Publish under the registered Marketplace identity `harveyh.jaxtypinglint`.
- Add Marketplace installation and local-package migration instructions.

## 0.2.0

- Replace repeated function signatures with shape-only tables.
- Show shared dtypes once; retain a dtype column for mixed annotations.
- Use a single-line summary for parameters and variables, with clear scalar labels.
- Preserve shaped return structure separately and omit unshaped return boilerplate.
- Make optional signature help compact, with only the active argument's shape below.
- Handle literal backticks, pipes, and HTML safely in the Markdown presentation.

## 0.1.0

- Show declared jaxtyping shapes in Python hovers alongside Pylance.
- Add optional shape-aware signature help.
- Warn about multiple variadic axes in a shape.
- Read source without a Python interpreter or JAX dependency.

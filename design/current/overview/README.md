# Overview

High-level framing of what `rundown` is, why it exists, and the model it operationalizes.

Prediction now lives in a separate project. In this repository, `rundown` design scope is bounded to lifecycle operations in the local workspace: `design release`, planner-driven migration authoring via `migrate`, `materialize`, `undo`/`revert`, and materialised-mode `test`.

## Files

| File | Topic |
|---|---|
| [purpose.md](purpose.md) | What `rundown` does at the lowest level (the workload protocol) and at the highest (prediction loop) |
| [prediction-model.md](prediction-model.md) | The plan/build/predict philosophy that shapes the command surface |
| [glossary.md](glossary.md) | Terminology used throughout the rest of `design/current/` |

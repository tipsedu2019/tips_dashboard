# Domain Docs

This repo uses a single-context documentation layout for agent skills.

## Read Before Deep Work

- `CONTEXT.md` at the repo root, if it exists
- `docs/adr/`, if it exists
- Relevant source files and tests before making implementation decisions

If `CONTEXT.md` or `docs/adr/` do not exist yet, proceed silently. Skills such as `grill-with-docs` can create or extend them when the domain language or architectural decisions become concrete.

## Vocabulary

Use the vocabulary already present in the codebase and product UI. For this repo, especially preserve the existing Korean operational terms around 수업계획, 교재관리, 요청, 주문, 입고, 출고, 재고, 정산, 선생님, 학생, 수업, and 학사일정.

When a new term is needed, add it deliberately through `CONTEXT.md` rather than inventing synonyms across files.

## ADRs

If a proposed change conflicts with an existing ADR, surface the conflict explicitly before implementing.

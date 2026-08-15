<!-- KKCODER:RULES_POINTER_START -->
> [!IMPORTANT]
> **Project Rules & Guidelines**: You MUST strictly adhere to all instructions and constraints defined in [`RULE.md`](./RULE.md) before planning or executing any tasks.
<!-- KKCODER:RULES_POINTER_END -->

# Agent notes (KKCoder)

## Frontend source index (required)

- **Authoritative catalog:** [`src/SOURCE_INDEX.md`](src/SOURCE_INDEX.md)
- **Always-on rule:** [`.cursor/rules/source-index.mdc`](.cursor/rules/source-index.mdc)

When you add, remove, rename, or change exports under `src/`, update `SOURCE_INDEX.md` in the same change, and keep `components/index.ts` / `hooks/index.ts` / `utils/index.ts` aligned when APIs are public.

Organization conventions (not a full file list): `.trellis/spec/frontend/directory-structure.md`.

## GUI 参考

如果涉及到GUI模块的功能，都可以参考 `D:\CODE\desktop-cc-gui`

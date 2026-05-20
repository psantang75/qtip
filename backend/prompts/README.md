# `backend/prompts/`

What lives in this directory and — equally important — what does NOT.

## In-tree (versioned with code)

The AI Reviewer's prompt **plumbing** lives here. These files are loaded
by [backend/src/services/promptLoader.ts](../src/services/promptLoader.ts)
at process start, cached by name, and supplied to Claude verbatim with
`{{key}}` interpolation only.

```
ai-reviewer/
  system.v1.md      legacy single-pass system prompt (kept for byte equivalence / regression baseline)
  system.v2.md      legacy single-pass system prompt
  user.v1.md        per-source user-message template (interpolation-only; not editable content)
```

Edit `user.v1.md` via a normal PR — it's just plumbing (header + notes
rendering + KB excerpt block). The legacy `system.v1.md` / `system.v2.md`
files exist only as a regression baseline; production no longer uses them.

## DB-managed (NOT in this directory)

Anything an admin authors through the UI lives in the database, not on
disk:

| What                          | Storage                            | UI                                                                         |
| ----------------------------- | ---------------------------------- | -------------------------------------------------------------------------- |
| **Universal base prompts**    | `ai_base_prompt` + `ai_base_prompt_version` | **Base Prompt Library page (Admin only)** + Universal base card per form    |
| Per-question rubrics          | `ai_form_question_rubric`          | "Question rubrics" card on the AI Reviewer Form Detail page                |
| Rule pack bodies              | `ai_rule_pack`                     | Rule Pack Library page                                                     |
| Form → rule pack assignments  | `ai_form_rule_pack_assignment`     | Chip picker on the AI Reviewer Form Detail page                            |
| Form → base prompt assignment | `forms.ai_base_prompt_id`          | Universal base picker on the AI Reviewer Form Detail page                  |

### Universal base prompts

The three base prompts that used to live as `system.v3.md`,
`trace.v1.md`, and `synthesis.v1.md` are now DB rows
(migration `20260515080000_add_ai_base_prompt_tables`). They moved to
the database for the same reasons the rule packs and rubrics did:

- A `system.v3` edit had to ship as a code change + redeploy. Admin /
  prompt-engineering iteration speed was bounded by the deploy cadence.
- The "universal" base was actually domain-specific in places (it
  prescribed a 6-line narrative format mostly relevant to tech-support
  tickets). Different domains (sales, warranty, shipping) want different
  bases. The DB partitions bases by `prompt_kind` so you can author a
  `sales-discovery.v1` base that single-source sales forms opt into,
  without forking the codebase.
- Versioning + rollback: every save creates a new immutable
  `ai_base_prompt_version` row. The Base Prompt Library page exposes
  history + a forward-only rollback flow (rollback creates a new version
  whose body is a copy of the selected old one — history is never
  erased).

The seed bodies for the three default rows are loaded by
[BasePromptService.warmCache()](../src/services/BasePromptService.ts) on
first boot from the legacy `.md` files in this directory if they still
exist. Once the DB rows are in place the files are not consulted again,
and admin edits through the UI take precedence. The files remain in the
repo as a disaster-recovery seed source — feel free to delete them once
production has been on the DB-managed path long enough that you trust the
backup story.

### Other DB-managed surfaces

The chip-picker assignment, rule pack bodies, and per-question rubrics
all moved to the DB in migration
`20260513100000_add_ai_rubric_and_rule_pack_tables` for the same
operational reasons (multi-instance writes, admin self-service, no
code-change for content edits).

The service layer caches all of the above in-process and refreshes on
writes (plus every 60s as a multi-instance staleness backstop). See
[BasePromptService.ts](../src/services/BasePromptService.ts),
[RulePackService.ts](../src/services/RulePackService.ts), and the
rubrics block of
[aiReviewerPrompt.ts](../src/services/aiReviewerPrompt.ts).

If you find yourself wanting to drop a markdown file in this directory
to add a rubric, rule pack, or universal base, you're in the wrong place —
open the appropriate library page instead.

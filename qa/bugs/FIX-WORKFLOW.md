# Fix workflow

QA keeps defects in `qa/bugs/registry.json`. This file is the record. The workflow does not `POST /api/tasks` and it does not publish.

Four steps, in order:

1. **OpenCode proposal.** A fix is proposed on an isolated branch. Record status `proposed` and name the proposal in the note. QA does not run OpenCode.
2. **Isolated test.** The proposal is exercised on a scratch database or a detached worktree. Record status `isolated_test` and the command that was run. The branch under test stays off `feat/quality-automation` unless the change is QA tooling on this branch.
3. **QA verify.** QA repeats the repro from the registry entry and records status `qa_verified` with an evidence path. `ownerApproval` stays false.
4. **Owner approve.** The owner sets status `owner_approved`. That is the only status that sets `ownerApproval` to true. QA does not set it.

`blocked` means the next check needs something this environment does not have (horizons source access, a Mac, the final voice, the Blender master model). `wontfix` and `duplicate` stop the line. None of those are owner approval.

## Commands

From the studio repo root:

```bash
node qa/bugs/registry.mjs validate
node qa/bugs/registry.mjs list
node qa/bugs/registry.mjs add --file entry.json
node qa/bugs/registry.mjs update QA-APR-001 --status qa_verified --note "repro no longer stores approved" --evidence qa/reports/example/REPORT.md
```

`update` appends a history row. `owner_approved` is valid only together with `ownerApproval: true`, and the script sets that flag itself when the status is `owner_approved`. `npm run qa:bugs` runs `validate`.

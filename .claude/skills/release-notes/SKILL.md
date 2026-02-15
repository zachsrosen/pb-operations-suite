---
name: release-notes
description: Generate release notes from git commits. Use when preparing a release, changelog, or deployment summary.
disable-model-invocation: true
---

## Git Context
- Current branch: !`git branch --show-current`
- Last tag: !`git describe --tags --abbrev=0 2>/dev/null || echo "no tags found"`
- Recent commits: !`git log --oneline -20`

## Generate Release Notes

Create a release notes summary from recent commits.

If `$ARGUMENTS` is provided, use it as the range (e.g., "v1.2.0..HEAD" or "last 10 commits").
Otherwise, generate from all commits since the last tag, or the last 20 commits if no tags exist.

### Format

```markdown
## Release Notes — [date]

### New Features
- [feature descriptions from feat: commits]

### Bug Fixes
- [fix descriptions from fix: commits]

### Improvements
- [refactors, performance, UX improvements]

### Infrastructure
- [build, deploy, CI changes]
```

### Rules

1. Group commits by type (feat, fix, refactor, chore, etc.)
2. Write **user-friendly descriptions** — translate technical commits into what changed for operators
3. Combine related commits into single bullet points
4. Highlight breaking changes prominently at the top
5. Skip merge commits and trivial changes (typo fixes, whitespace)
6. Include the commit range at the bottom for reference
7. If a commit mentions a dashboard name, include it (e.g., "Scheduler", "Equipment Backlog")

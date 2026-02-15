---
name: deploy
description: Run preflight checks, build, and deploy to Vercel. Use when user says "deploy" or "push to production".
disable-model-invocation: true
---

## Current State
- Branch: !`git branch --show-current`
- Status: !`git status --short`
- Last commit: !`git log --oneline -1`

## Deploy Workflow

Deploy the PB Operations Suite to Vercel production.

1. **Check for uncommitted changes**
   - If there are uncommitted changes, warn the user and ask if they want to commit first
   - Use `/commit` skill if they want to commit

2. **Run preflight checks**
   ```bash
   npm run preflight
   ```
   - If preflight fails, show errors and stop

3. **Run production build locally**
   ```bash
   npm run build
   ```
   - If build fails, show errors and stop
   - Common issues: TypeScript errors, missing env vars, Prisma schema drift

4. **Deploy to Vercel**
   ```bash
   npx --yes vercel@latest --prod --yes
   ```

5. **Verify deployment**
   - Check the deployment URL is accessible
   - Report the production URL to the user

If any step fails, stop and report the error. Do not skip steps.

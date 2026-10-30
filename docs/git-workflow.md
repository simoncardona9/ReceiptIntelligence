# Git Workflow

- Keep `main` releasable and protected.
- Use one branch per roadmap step. Start it from the default branch and keep
  all approved slices for that step on that branch. Start the next step branch
  from the updated default branch after the prior step is reviewed and merged.
- Approval is per slice unless the user explicitly authorizes all slices of a
  named step. A step branch alone does not authorize unapproved work. If the
  user chooses review-gated delivery, wait for approval between slices.
- Make commits small and descriptive; do not commit secrets, receipt files, generated build output, or real user data.
- Check and review each slice's diff before committing, then push each slice
  commit to the step branch. Run a full step check after the final slice and
  commit/push any corrections there. Never push directly to `main`.
- Review the diff and tests before opening a pull request.
- The pull request must state user outcome, scope, requirements, risks, tests, migrations, and remaining limitations.
- Only the project owner approves and merges changes to `main`.

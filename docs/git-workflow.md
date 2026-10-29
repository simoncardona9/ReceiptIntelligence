# Git Workflow

- Keep `main` releasable and protected.
- Use one branch per roadmap step. Start it from the default branch and keep
  all approved slices for that step on that branch. Start the next step branch
  from the updated default branch after the prior step is reviewed and merged.
- Approval remains per slice; a step branch does not authorize unapproved work.
- Make commits small and descriptive; do not commit secrets, receipt files, generated build output, or real user data.
- Review the diff and tests before opening a pull request.
- The pull request must state user outcome, scope, requirements, risks, tests, migrations, and remaining limitations.
- Only the project owner approves and merges changes to `main`.

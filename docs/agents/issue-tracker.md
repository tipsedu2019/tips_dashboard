# Issue Tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `tipsedu2019/tips_dashboard`. Use the `gh` CLI from the repo root so it can infer the repository from `git remote -v`.

## Commands

- Create an issue: `gh issue create --title "..." --body "..."`
- Read an issue: `gh issue view <number> --comments`
- List issues: `gh issue list --state open --json number,title,body,labels,comments`
- Comment on an issue: `gh issue comment <number> --body "..."`
- Apply or remove labels: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close an issue: `gh issue close <number> --comment "..."`

## Skill Behavior

When a skill says to publish a PRD, plan, or task to the issue tracker, create a GitHub issue.

When a skill says to fetch a ticket, read the GitHub issue and its comments before proposing work.

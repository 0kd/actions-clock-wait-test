# GitHub-only clock experiment

This is a finite, generic experiment, not a paper notification application. It contains no personal data, paper data, mail configuration or cross-repository credentials.

The first tick runs immediately in the `clock-seed` environment. The two successors use GitHub's environment wait rule for nine minutes, then wait at most two additional minutes on a GitHub-hosted runner to reach a predetermined tick. Each records the actual time and requests at most one successor workflow in the same repository. It stops after three ticks and has no native cron or external service dependency.

Before running, configure an environment named `clock-wait-nine-minutes` with a nine-minute wait timer and a deployment branch rule that permits only `main`. Configure `clock-seed` with the same branch restriction and no wait timer. Start `clock.yml` with `planned_for` set to the current UTC time and `remaining=3`. Do not manually bypass the successor environment's wait rule. A missing rule, a start more than two minutes early, or a tick more than two minutes late stops the chain.

GitHub Free/Pro/Team provide environment wait timers only in public repositories; waiting in that environment does not count as billable runner time. This public experiment can test whether that mechanism works for the affected account. It has not yet been run on GitHub, so it is not a verified replacement for native cron.

Public data would consist of these source files, timestamps, workflow execution logs, and small timing artifacts. The built-in token can only request workflows in this experiment's own repository. The experiment does not call any private repository or send any paper notifications. Artifacts expire after three days; GitHub's separate log-retention settings apply to execution logs.

Passing criteria: three distinct recorded ticks, planned exactly ten minutes apart, each received no more than two minutes late. Unit tests simulate the timer, but they are not evidence of GitHub's real wait-timer behavior. A production connection would require a separate change and a repository-scoped credential kept in GitHub Secrets.

To stop, disable the workflow and cancel any current runs. The default experiment also stops itself after its third tick.

Reference: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#wait-timer

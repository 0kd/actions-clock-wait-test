# GitHub-only clock experiment

This is a finite, generic experiment, not a paper notification application. It contains no personal data, paper data, mail configuration or cross-repository credentials.

The first tick runs immediately in the `clock-seed` environment. The two successors use GitHub's environment wait rule for nine minutes, then wait at most two additional minutes on a GitHub-hosted runner to reach a predetermined tick. Each records the actual time and requests at most one successor workflow in the same repository. It stops after three ticks and has no native cron or external service dependency.

Before running, configure an environment named `clock-wait-nine-minutes` with a nine-minute wait timer and a deployment branch rule that permits only `main`. Configure `clock-seed` with the same branch restriction and no wait timer. Start `clock.yml` with `planned_for` set to the current UTC time and `remaining=3`. Do not manually bypass the successor environment's wait rule. A missing rule, a start more than two minutes early, or a tick more than two minutes late stops the chain.

GitHub Free/Pro/Team provide environment wait timers only in public repositories; waiting in that environment does not count as billable runner time. This public experiment can test whether that mechanism works for the affected account. The finite test completed successfully on September 28, 2026. This is not proof of native cron recovery or long-term reliability.

Public data consists of these source files, timestamps, workflow execution logs, and small timing artifacts. The built-in token can only request workflows in this experiment's own repository. The experiment does not call any private repository or send any paper notifications. Artifacts expire after three days; GitHub's separate log-retention settings apply to execution logs.

Passing criteria: three distinct recorded ticks, planned exactly ten minutes apart, each received no more than two minutes late. Unit tests simulate the timer, but they are not evidence of GitHub's real wait-timer behavior. A production connection would require a separate change and a repository-scoped credential kept in GitHub Secrets.

To stop, disable the workflow and cancel any current runs. The default experiment also stops itself after its third tick.

Reference: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#wait-timer

## Completed experiment — September 28, 2026

All three runs used commit `ed56f71c52440f4f9ca113e334a201199a3e7435`.

| Tick | Planned time (UTC) | Observed time (UTC) | Lateness |
| --- | --- | --- | ---: |
| [1](https://github.com/0kd/actions-clock-wait-test/actions/runs/36422585935) | 2026-09-28T12:33:25.760Z | 2026-09-28T12:33:37.986Z | 12.226 s |
| [2](https://github.com/0kd/actions-clock-wait-test/actions/runs/36422605516) | 2026-09-28T12:43:25.760Z | 2026-09-28T12:43:25.780Z | 0.020 s |
| [3](https://github.com/0kd/actions-clock-wait-test/actions/runs/36423662534) | 2026-09-28T12:53:25.760Z | 2026-09-28T12:53:25.789Z | 0.029 s |

Actual intervals were 587.794 and 600.009 seconds; the first tick includes initial startup latency. Both successor jobs were observed waiting without a runner. Their first runner steps began 542 and 543 seconds after the nine-minute environment wait started. The final receipt reported `successor_requested: false`.

At 12:54 UTC, exactly three completed successful runs existed, and the workflow was disabled after collecting the results. No fourth run was created. No application or private repository was connected. This completed a finite timing test only; continued operation and recovery from failures have not been validated.

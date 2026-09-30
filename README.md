# Bounded notification clock

This bounded clock prepares all tick jobs in one GitHub workflow, so a lost request to create the next workflow cannot break the clock. It uses GitHub environment waits, then at most two minutes of runner waiting. It has no native cron, external timer, or Mac timer.

`connected-clock.yml` accepts either three ticks or a 24-hour, 144-slot session. Defaults are three ticks in diagnostic mode. The initial job fixes the start at the next UTC ten-minute boundary and the end at start plus the selected duration. Slots are strictly serialized. A transient dispatch failure allows the next job to proceed; a configuration failure, authentication rejection, explicit cancellation, disabled workflow or deadline stops the session. Unexpected runner failures use a nine-minute fallback before attempting recovery. A late job services only the most recent slot and returns to the original cadence. It does not replay all missed ticks.

Normal operation remains dependent on GitHub environment scheduling, runner availability, the target credential and the Mac. A job failure can miss a tick. Tests simulate failure handling; they do not prove ten-minute delivery on GitHub. A whole-workflow cancellation stops all remaining ticks and needs an explicit new session. There is no indefinite automatic restart after the 24-hour deadline.

## Public files and data

Publish only these five bundle files:

- `.github/workflows/connected-clock.yml`
- `.github/workflows/clock-tick.yml`
- `session.mjs`
- `dispatch.mjs`
- `README.md`

Public logs contain clock timestamps, lag, skipped-slot counts and generic dispatch status. Private repository names, target run IDs, paper metadata, author/keyword filters, explanations, SMTP settings and Codex credentials are not printed. Tests and the generator stay in the private source repository. The target workflow filename is generic code, not an account identifier.

## Setup

Use the existing public clock repository. Keep the original three-tick `clock.yml` disabled and unchanged. The new entry point is `connected-clock.yml`.

Create environments `clock-seed` (no wait) and `clock-wait-1` through `clock-wait-9` (one through nine minutes). Each must have exactly one selected deployment-branch rule of type `branch`, named `main`, and no required reviewer. Preparation verifies all ten environments before any target request. Each tick checks its actual environment again.

Add repository Secrets:

- `TARGET_REPOSITORY`: the private production repository name.
- `PRIVATE_DISPATCH_TOKEN`: a fine-grained token restricted to that one repository, with Actions read/write and the accompanying Metadata read permission. No Contents write or Secrets permissions are needed. Do not reuse a broad CLI or Codex token. Use an expiration that covers the approved test.

The production repository must already contain the diagnostic receiver and `publisher_mac_worker.yml`. The latter continues to check its existing enable flags, use its existing concurrency group and preserve sent-paper history. In diagnostic mode only the receiver runs. In notify mode the clock directly requests the self-hosted Mac worker; no private hosted intermediary is used.

Before notifying, run three diagnostic ticks and verify actual target receipt times. Then start one 144-slot notify session and record its fixed UTC/JST start and end. Verify all expected slots, actual collection starts, missed/late slots, pending Mac jobs, email results and billing; successful dispatch requests alone do not establish successful notification delivery. Both modes require deployment approval. This deployment is approved for three diagnostic receipts followed by one 24-hour notification session; it does not authorize indefinite operation.

To stop, disable `connected-clock.yml` and cancel its active workflow run. Already requested private notification runs are separate; inspect those before canceling an in-progress mail worker. To restart after a stop, use a new dispatch rather than rerunning old jobs. Reruns are rejected.

## Mac outages

The dispatcher checks active target runs without a date cutoff, including workflows marked in progress whose Mac job is still waiting. It retains one outstanding wake-up request instead of adding one every ten minutes. If GitHub expires that queued job, a later clock tick can request a replacement. Once the Mac reconnects, it performs a fresh RSS/Crossref collection and resumes its saved notification state.

This does not collect articles while the Mac is off. A sufficiently long outage can miss papers that disappear from RSS before reconnection. Existing queued article metadata and delivery checkpoints remain on the private side.

GitHub environment waits are available on the current Pro plan for public repositories and do not count as billable runner time. The public jobs use standard Ubuntu runners; real work runs on the existing self-hosted Mac. See [environment wait rules](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#wait-timer) and [Actions limits](https://docs.github.com/en/actions/reference/limits).

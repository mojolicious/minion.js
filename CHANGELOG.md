
# Changelog

This package strictly follows [Semantic Versioning](https://semver.org).

## v2.0.1 (2026-10-24)

### Bug Fixes

  * Fixed a race condition in tests where jobs enqueued by other tests running in parallel could wake up a waiting
    `dequeue` early.

## v2.0.0 (2026-10-24)

### Breaking Changes

  * Removed support for Node.js versions older than 22.18.
  * Updated `@mojojs/core` to version 2.0.
  * Updated `@mojojs/pg` to version 2.0.
  * Replaced `nopt` with `util.parseArgs` for the `minion-job` and `minion-worker` commands, option abbreviations like
    `--worker` for `--workers` are no longer supported, and unknown options as well as invalid numbers are now an error.
  * Updated `js-yaml` to version 5.0.
  * Removed `nopt` dependency.
  * PostgreSQL 13 or later is now required.
  * The interval options of the `minion-worker` command now use seconds as documented, instead of milliseconds.
  * `minion.backoff()` now returns milliseconds instead of seconds.
  * Third party backends need to implement the new `dispatchSchedules`, `listSchedules`, `pauseSchedule`,
    `resumeSchedule`, `schedule` and `unschedule` methods, and support the `tasks` option of `dequeue`.

### Features

  * Added support for cron style recurring jobs with `dispatchSchedules`, `listSchedules`, `pauseSchedule`,
    `resumeSchedule`, `schedule` and `unschedule` methods to `Minion` and `PgBackend`.
  * Added schedules page to the admin ui.
  * Added `schedules` and `inactive_schedules` fields to stats.
  * Added `dispatchInterval` status option to `Worker`.
  * Added `minion-schedule` command for managing schedules from the command line.
  * Added `--dispatch-interval` option to the `minion-worker` command.
  * Added support for task limits with the `limits` status option to `Worker` and the `tasks` option to `dequeue`.
  * Added `-L` option to the `minion-worker` command.
  * Added `spare` remote control command, this allows workers to be paused again by combining `jobs` and `spare`.
  * Added `util` export with `desiredTasks`, `nextCronTime` and `parseCron` functions.
  * Added `id` field to `listLocks` method in `PgBackend`.
  * Improved admin ui to allow filtering jobs by tasks not registered in the current process.
  * Improved admin ui to log whenever a job gets removed.

### Bug Fixes

  * Fixed a bug where finished jobs were removed by `minion.repair()` 1000 times later than configured with
    `removeAfter`.
  * Fixed a bug where jobs were automatically retried after a few milliseconds instead of seconds.
  * Fixed a problem where remote control commands would not immediately update the worker status.
  * Fixed a bug where the `repairInterval` of workers was not randomized when customized.
  * Fixed a bug where the `jobs` remote control command accepted invalid values like negative numbers.

## v1.0.0 (2024-08-23)

First major release.

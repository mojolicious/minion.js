
# Changelog

This package strictly follows [Semantic Versioning](https://semver.org).

## v2.0.0 (2026-10-24)

### Breaking Changes

  * Removed support for Node.js versions older than 22.18.
  * Updated `@mojojs/core` to version 2.0.
  * Updated `@mojojs/pg` to version 2.0.
  * Replaced `nopt` with `util.parseArgs` for the `minion-job` and `minion-worker` commands, option abbreviations like
    `--worker` for `--workers` are no longer supported, and unknown options as well as invalid numbers are now an error.
  * Updated `js-yaml` to version 5.0.
  * Removed `nopt` dependency.

## v1.0.0 (2024-08-23)

First major release.

#!/usr/bin/env python3
"""Fail when `review-tools.check-notices` reports Ubuntu Security Notices.

Reads its JSON ({snap: {revision: {package: [USN, ...]}}}) on stdin. With
--warn-only (used for Canonical's runtime snaps, which this project cannot
patch) the findings are printed but do not fail the build.
"""
import json
import sys

warn_only = "--warn-only" in sys.argv[1:]
report = json.loads(sys.stdin.read() or "{}")
findings = [
    f"{snap} (revision {rev}): {pkg} ({', '.join(usns)})"
    for snap, revisions in report.items()
    for rev, packages in revisions.items()
    for pkg, usns in packages.items()
]
for line in findings:
    print(("Warning: " if warn_only else "Unpatched: ") + line)
if findings and not warn_only:
    sys.exit("Staged packages have unpatched Ubuntu Security Notices.")
print(f"USN check: {len(findings)} finding(s).")

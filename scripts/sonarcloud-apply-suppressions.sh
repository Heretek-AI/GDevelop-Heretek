#!/usr/bin/env bash
# SonarCloud suppressions setup
#
# After this PR is merged, the operator (you) must paste the multicriteria
# block from .sonarcloud.properties into SonarCloud so the open-issue
# count drops. This script is a no-op run helper that prints the
# steps and the relevant block locations.
#
# Usage:
#   bash scripts/sonarcloud-apply-suppressions.sh
#
# After running, complete the steps printed to the console, then verify
# with:
#   node scripts/sonarcloud-drift.js --update-baseline

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROPS="$REPO_ROOT/.sonarcloud.properties"

cat <<EOF
=== SonarCloud suppressions setup ===

This script is a checklist. Apply each step in SonarCloud's web UI.

Step 1 — Path exclusions
  Open: https://sonarcloud.io/project/settings?category=scope&id=Heretek-AI_GDevelop-Heretek
  Section: "Analysis Scope" → "Source File Exclusions"
  Paste (as a comma-separated list, all on one line):

$(awk '/^sonar.exclusions=/,/^$/' "$PROPS" | head -50 | tr -d '\\\n' | sed 's/^sonar.exclusions=//' | sed 's/^/  /')

Step 2 — Per-rule multicriteria suppressions
  Open: https://sonarcloud.io/project/settings?category=exclusions&id=Heretek-AI_GDevelop-Heretek
  Section: "Issues Exclusions" → "Multi-criteria" → "Add"
  For each entry in the comment block below, click "Add" and paste
  the ruleKey + resourceKey lines as a new criterion.

  (The entries are documented in $PROPS as commented-out lines
  starting with "sonar.issue.ignore.multicriteria.eN.ruleKey=". Uncomment
  each line to see what to paste.)

Step 3 — Verify
  After pasting, run:
    node scripts/sonarcloud-drift.js --update-baseline

  This records the current count as the new baseline so subsequent
  drift checks compare against it.

Step 4 — Watch the result
  The expected drop is from ~3,029 open (pre-suppressions) to ~500-1,000
  (post-suppressions). If you see a smaller drop, check the
  SonarCloud audit log for any entries that failed to import.

EOF

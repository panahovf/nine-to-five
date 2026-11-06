# Has Statistics Canada released new data today in any of this page's tables, that the page doesn't have yet?
#
# Statistics Canada's Web Data Service publishes, for every day, the list of tables that got new or revised data that day
# (getChangedCubeList), with their release time (8:30 Toronto time). This compares that list with the tables in
# series.csv and, if one of them is on it, checks whether the page was already rebuilt after that release (the
# "built_at" time in site/data/labour.json): the weekday runs retry every hour, and once the page is up to date the
# later ones stop here. It prints the answer and, on GitHub Actions, passes "released=true" or "released=false" to the
# next steps. If there is no list yet (asked before the day's releases are out: "The product is not released yet") or
# the service can't be reached, it counts as not released, and a later run asks again.
#
#   python3 tools/released_today.py [YYYY-MM-DD]        (default: today in Toronto)
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

WDS = "https://www150.statcan.gc.ca/t1/wds/rest/getChangedCubeList/"
TORONTO = ZoneInfo("America/Toronto")
HERE = os.path.dirname(os.path.abspath(__file__))

day = sys.argv[1] if len(sys.argv) > 1 else datetime.now(TORONTO).date().isoformat()

# this page's tables: "14-10-0287-01" in series.csv is product 14100287 in the Web Data Service
with open(os.path.join(HERE, "..", "series.csv"), encoding="utf-8") as f:
    ours = {row["table"][:10].replace("-", "") for row in csv.DictReader(f) if row["source"] == "statcan"}

# the tables Statistics Canada changed that day, and when (Toronto time, e.g. "2026-11-06T08:30"). The service is slow on
# release mornings, so a timeout is tried again, up to three times; "not released yet" is final.
changed = {}
for attempt in range(1, 4):
    try:
        with urllib.request.urlopen(WDS + day, timeout=90) as r:
            changed = {str(item["productId"]): item.get("releaseTime") for item in json.load(r).get("object", [])}
        break
    except (OSError, ValueError) as e:          # (HTTP and network errors are OSErrors; a page that isn't JSON, ValueError)
        detail = e.read().decode("utf-8", "replace")[:200] if isinstance(e, urllib.error.HTTPError) else str(e)
        print(f"{day}: no list of changed tables, try {attempt} of 3 ({detail}).")
        if isinstance(e, urllib.error.HTTPError) or attempt == 3:
            print("Counting it as not released.")
            break
        time.sleep(20)

hits = sorted(ours & set(changed))
print(f"{day}: {len(changed)} tables changed at Statistics Canada; ours among them: {', '.join(hits) if hits else 'none'}")
released = bool(hits)

# already rebuilt after that release? (built_at is in UTC, e.g. "2026-11-06T14:05Z")
if released:
    times = [changed[t] for t in hits if changed[t]]
    latest = max(datetime.strptime(t, "%Y-%m-%dT%H:%M").replace(tzinfo=TORONTO) for t in times) if times else None
    with open(os.path.join(HERE, "..", "site", "data", "labour.json"), encoding="utf-8") as f:
        built = datetime.strptime(json.load(f)["built_at"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
    if latest and built >= latest:
        print(f"The page was rebuilt at {built.astimezone(TORONTO):%Y-%m-%d %H:%M} Toronto time, after this release: nothing to do.")
        released = False

if os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"released={'true' if released else 'false'}\n")

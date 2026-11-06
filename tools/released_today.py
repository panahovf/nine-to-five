# Has Statistics Canada released new data in any of this page's tables today?
#
# Statistics Canada's Web Data Service publishes, for every day, the list of tables that got new or revised data that day
# (getChangedCubeList), with their release time (8:30 Toronto time). This compares that list with the tables in
# series.csv, prints the answer and, on GitHub Actions, passes "released=true" or "released=false" to the next steps.
# If there is no list yet (asked before the day's releases are out: "The product is not released yet") or the service
# can't be reached, it counts as not released, and a later run asks again.
#
#   python3 tools/released_today.py [YYYY-MM-DD]        (default: today in Toronto)
import csv
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

WDS = "https://www150.statcan.gc.ca/t1/wds/rest/getChangedCubeList/"

day = sys.argv[1] if len(sys.argv) > 1 else datetime.now(ZoneInfo("America/Toronto")).date().isoformat()

# this page's tables: "14-10-0287-01" in series.csv is product 14100287 in the Web Data Service
series_csv = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "series.csv")
with open(series_csv, encoding="utf-8") as f:
    ours = {row["table"][:10].replace("-", "") for row in csv.DictReader(f) if row["source"] == "statcan"}

# the tables Statistics Canada changed that day
try:
    with urllib.request.urlopen(WDS + day, timeout=60) as r:
        changed = {str(item["productId"]) for item in json.load(r).get("object", [])}
except (OSError, ValueError) as e:              # (HTTP and network errors are OSErrors; a page that isn't JSON, ValueError)
    detail = e.read().decode("utf-8", "replace")[:200] if isinstance(e, urllib.error.HTTPError) else str(e)
    print(f"{day}: no list of changed tables ({detail}). Counting it as not released.")
    changed = set()

hits = sorted(ours & changed)
print(f"{day}: {len(changed)} tables changed at Statistics Canada; ours among them: {', '.join(hits) if hits else 'none'}")
if os.environ.get("GITHUB_OUTPUT"):
    with open(os.environ["GITHUB_OUTPUT"], "a") as f:
        f.write(f"released={'true' if hits else 'false'}\n")

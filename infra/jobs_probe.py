"""Does the live server accept the schedule strings the app generates? Create -> read back -> patch -> delete."""

import sys

sys.argv = sys.argv[:2]
from protocol_probe import req, short  # noqa: E402

CASES = [
    ("daily 08:00", "0 8 * * *"),
    ("weekdays 09:30", "30 9 * * 1-5"),
    ("weekly Fri 17:00", "0 17 * * 5"),
    ("interval 6h", "every 6h"),
    ("interval 45m", "every 45m"),
    ("invalid", "whenever you feel like it"),
]


def main():
    created = []
    for label, sched in CASES:
        st, body = req("POST", "/api/jobs", {"name": f"probe {label}", "prompt": "Reply hi", "schedule": sched, "deliver": "local"})
        job = body.get("job") or {}
        if st < 300 and job.get("id"):
            created.append(job["id"])
            print(f"OK   {label:18s} {sched!r:18} -> kind={(job.get('schedule') or {}).get('kind')} display={job.get('schedule_display')!r} next={job.get('next_run_at')}")
        else:
            print(f"FAIL {label:18s} {sched!r:18} -> http={st} {short(body, 220)}")

    if created:
        st, body = req("PATCH", f"/api/jobs/{created[0]}", {"schedule": "15 7 * * *", "name": "probe renamed"})
        job = body.get("job") or {}
        print(f"PATCH schedule: http={st} display={job.get('schedule_display')!r} name={job.get('name')!r}")
        st, lst = req("GET", "/api/jobs")
        print(f"LIST: http={st} jobs={len(lst.get('jobs', []))}")
    for jid in created:
        req("DELETE", f"/api/jobs/{jid}")
    st, lst = req("GET", "/api/jobs")
    print(f"after cleanup jobs={len(lst.get('jobs', []))}")


if __name__ == "__main__":
    main()

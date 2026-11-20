"""Count or expire inactive online rooms without touching other Firebase data."""
import argparse
import time
from urllib.parse import quote

ROOMS_URL = "https://cinemaguess-default-rtdb.europe-west1.firebasedatabase.app/rooms"
EXPIRY_MS = 24 * 60 * 60 * 1000
SCOPES = [
    "https://www.googleapis.com/auth/firebase.database",
    "https://www.googleapis.com/auth/userinfo.email",
]


def timestamp(value):
    return value if type(value) is int and value > 0 else 0


def is_expired(room, cutoff):
    if not isinstance(room, dict):
        return False
    meta = room.get("meta") or {}
    state = room.get("state") or {}
    players = room.get("players") or {}
    if not all(isinstance(value, dict) for value in (meta, state, players)):
        return False
    host_off = timestamp(meta.get("hostOff"))
    ended_at = timestamp(state.get("endedAt")) if state.get("phase") == "end" else 0
    disconnects = [
        timestamp(player.get("off")) if isinstance(player, dict) else 0
        for player in players.values()
    ]
    abandoned = host_off and all(disconnects)
    if not ended_at and not abandoned:
        return False
    last_activity = max(ended_at, host_off, timestamp(meta.get("created")), *disconnects)
    return last_activity <= cutoff


def run(session, apply):
    index = session.get(f"{ROOMS_URL}.json", params={"shallow": "true"}, timeout=20)
    index.raise_for_status()
    keys = index.json() or {}
    if not isinstance(keys, dict):
        raise ValueError("Unexpected rooms index")
    cutoff = int(time.time() * 1000) - EXPIRY_MS
    expired = deleted = changed = 0
    for key in keys:
        url = f"{ROOMS_URL}/{quote(key, safe='')}.json"
        response = session.get(url, headers={"X-Firebase-ETag": "true"}, timeout=20)
        response.raise_for_status()
        if not is_expired(response.json(), cutoff):
            continue
        expired += 1
        if apply:
            etag = response.headers.get("ETag")
            if not etag:
                raise ValueError("Firebase did not return a room ETag")
            result = session.delete(url, headers={"if-match": etag}, timeout=20)
            if result.status_code == 412:
                changed += 1
                continue
            result.raise_for_status()
            deleted += 1
    print(f"Rooms: {len(keys)} | Expired: {expired} | Deleted: {deleted} | Changed: {changed}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Delete expired rooms")
    args = parser.parse_args()
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    credentials, _ = google.auth.default(scopes=SCOPES)
    with AuthorizedSession(credentials) as session:
        run(session, args.apply)


if __name__ == "__main__":
    main()

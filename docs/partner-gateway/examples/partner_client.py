"""Example partner integration in Python 3 (standard library only).
Set QUIZBOX_PARTNER_KEY (qbpk_...), and for events QUIZBOX_PARTNER_ID and QUIZBOX_EVENT_SECRET (whsec_...)."""
import hashlib, hmac, json, os, time, urllib.error, urllib.request

BASE = os.environ.get("QUIZBOX_BASE", "https://www.quizbox.io") + "/api/partner/v1"


def call(method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={
        "Authorization": "Bearer " + os.environ["QUIZBOX_PARTNER_KEY"], "Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        err = json.load(e)["error"]
        raise RuntimeError(f"{err['code']}: {err['message']}") from None


def send_event(event: dict):
    raw = json.dumps(event, separators=(",", ":"))
    t = int(time.time())
    v1 = hmac.new(os.environ["QUIZBOX_EVENT_SECRET"].encode(), f"{t}.{raw}".encode(), hashlib.sha256).hexdigest()  # sign the exact bytes sent
    req = urllib.request.Request(BASE + "/events", data=raw.encode(), method="POST", headers={
        "Content-Type": "application/json", "X-QuizBox-Partner": os.environ["QUIZBOX_PARTNER_ID"], "X-QuizBox-Signature": f"t={t},v1={v1}"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.load(r)


if __name__ == "__main__":
    contracts = call("GET", "/licences")["data"]
    active = next(c for c in contracts if c["active_now"] and c["remaining"] > 0)
    print(call("POST", "/seats", {"contract_id": active["contract_id"], "external_ref": "student-2041"}))

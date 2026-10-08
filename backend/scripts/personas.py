"""
Persona QA on a LOCAL stack (GUR-244): the environment, the accounts and one signed-in
origin per persona. How a run works: .claude/skills/guru-persona/SKILL.md. The personas:
backend/evals/personas/personas.yaml.

    cd backend
    venv/bin/python scripts/personas.py list
    venv/bin/python scripts/personas.py env --api http://localhost:8010 --tabs maya=8091,dev=8092,kai=8093
    venv/bin/python scripts/personas.py accounts --api http://localhost:8010 --personas maya,dev,kai
    venv/bin/python scripts/personas.py serve --api http://localhost:8010 --tabs maya=8091,dev=8092,kai=8093 --dist <web export>

list      The personas: id, viewport, time box, start screen and account email.
env       The lines a local stack needs before it starts: BETA_EMAILS (persona accounts are
          beta, so they can report), ALLOWED_ORIGINS (one origin per persona tab, for CORS)
          and EXPO_PUBLIC_API_URL for the web export.
accounts  Creates or reuses one account per persona through the backend's own signup and
          login routes. Passwords are generated here and kept in
          backend/evals/personas/.accounts.local.json (gitignored, mode 600). It prints only
          the emails, whether each was created or reused, and whether the server counts it
          as beta.
serve     One local port per persona. With --dist it serves the web export there as a
          single-page app (like vercel.json), so each persona has its own origin and its own
          sign-in. On its port, /__persona/signin/<id> signs that persona's tab in: it logs in
          through the backend, stores the tokens where the app keeps them on web
          (localStorage access_token and refresh_token) and opens the app. Without --dist a
          port only hands tokens out: /__persona/token/<id> returns them as JSON to a
          localhost page, for a web build you don't serve yourself. Either way the tokens
          never pass through an agent's tool call.

--as <id>=<email> runs a persona on an existing local account instead (for example the one
beta tester a stack already allows). --import-from <json> names a local credentials file
shaped {"accounts": {email: password}} to copy that account's password from.

Local only: every URL must be http on localhost, 127.0.0.1 or [::1]. Anything else, and
production above all, is refused. The backend allows 3 signups and 5 logins a minute per
address; accounts waits out a 429 once. Nothing here prints a password or a token.
"""
import argparse
import functools
import html
import http.server
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PERSONA_DIR = os.path.join(BACKEND, "evals", "personas")
LIBRARY = os.path.join(PERSONA_DIR, "personas.yaml")
ACCOUNTS = os.path.join(PERSONA_DIR, ".accounts.local.json")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
LOCAL_ORIGIN = re.compile(r"^http://(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$")
RATE_WAIT_S = 61
TIMEOUT_S = 20


# ── the library ──────────────────────────────────────────────────────────────

def load_library() -> dict:
    try:
        import yaml
    except ImportError:
        sys.exit("PyYAML is missing: run this with backend/venv/bin/python.")
    with open(LIBRARY) as f:
        lib = yaml.safe_load(f)
    lib["by_id"] = {p["id"]: p for p in lib["personas"]}
    return lib


def chosen(lib: dict, names) -> list:
    if not names or names == "all":
        return [p["id"] for p in lib["personas"]]
    ids = [n.strip().lower() for n in names.split(",") if n.strip()]
    unknown = [i for i in ids if i not in lib["by_id"]]
    if unknown:
        sys.exit(f"Unknown persona: {', '.join(unknown)}. Known: {', '.join(lib['by_id'])}.")
    return ids


def overrides(lib: dict, pairs) -> dict:
    """--as kai=qa-beta@example.com (repeatable, or comma separated) -> {"kai": "qa-beta@example.com"}."""
    out = {}
    for pair in ",".join(pairs or []).split(","):
        if not pair.strip():
            continue
        pid, _, email = pair.partition("=")
        pid, email = pid.strip().lower(), email.strip().lower()
        if pid not in lib["by_id"] or "@" not in email:
            sys.exit(f"--as wants <persona id>=<email>, got {pair!r}.")
        out[pid] = email
    return out


def email_for(lib: dict, pid: str, over: dict) -> str:
    return over.get(pid) or lib["email"].format(id=pid)


def tabs_of(lib: dict, spec) -> list:
    """--tabs maya=8091,dev=8092 -> [("maya", 8091), ("dev", 8092)]. One persona per port, one port per persona."""
    tabs = []
    for pair in (spec or "").split(","):
        if not pair.strip():
            continue
        pid, _, port = pair.partition("=")
        pid = pid.strip().lower()
        if pid not in lib["by_id"] or not port.strip().isdigit() or not 1024 <= int(port) <= 65535:
            sys.exit(f"--tabs wants <persona id>=<port>, got {pair!r}.")
        tabs.append((pid, int(port)))
    if len({p for p, _ in tabs}) != len(tabs) or len({n for _, n in tabs}) != len(tabs):
        sys.exit("--tabs: each persona gets its own port, and each port one persona.")
    return tabs


# ── local only ───────────────────────────────────────────────────────────────

def local_api(url: str) -> str:
    """The backend's base URL, local only. Accepts it with or without /api/v1."""
    u = urllib.parse.urlparse(url or "")
    host = (u.hostname or "").lower()
    if u.scheme != "http" or not (host in LOCAL_HOSTS or host.endswith(".localhost")):
        sys.exit(f"--api must be a local backend (http://localhost:<port>), not {url!r}. Never production.")
    base = url.rstrip("/")
    return base[: -len("/api/v1")] if base.endswith("/api/v1") else base


# ── the accounts file: {"accounts": {email: password}}, mode 600 ─────────────

def load_accounts(path: str = ACCOUNTS) -> dict:
    try:
        with open(path) as f:
            return dict(json.load(f).get("accounts") or {})
    except FileNotFoundError:
        return {}
    except (ValueError, AttributeError):
        sys.exit(f"{path} is not a credentials file shaped {{\"accounts\": {{email: password}}}}.")


def save_accounts(accounts: dict) -> None:
    data = {"note": "Persona QA test accounts for LOCAL stacks only (GUR-244). Gitignored. "
                    "Never commit, print or reuse these anywhere else.",
            "accounts": dict(sorted(accounts.items()))}
    tmp = ACCOUNTS + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, ACCOUNTS)
    os.chmod(ACCOUNTS, 0o600)


# ── the backend's own routes ─────────────────────────────────────────────────

class Unreachable(Exception):
    pass


# Straight to the local backend: never through a proxy from the shell's environment.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(method: str, url: str, body=None, token=None):
    req = urllib.request.Request(url, method=method,
                                 data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with _opener.open(req, timeout=TIMEOUT_S) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except ValueError:
            return e.code, None
    except (urllib.error.URLError, OSError) as e:
        raise Unreachable(str(getattr(e, "reason", e)))


def call_waiting(method: str, url: str, body=None, token=None):
    status, payload = call(method, url, body, token)
    if status == 429:
        print(f"  rate limited by the backend (3 signups, 5 logins a minute); waiting {RATE_WAIT_S}s", flush=True)
        time.sleep(RATE_WAIT_S)
        status, payload = call(method, url, body, token)
    return status, payload


def login(api: str, email: str, password: str, wait: bool = True):
    fn = call_waiting if wait else call
    return fn("POST", f"{api}/api/v1/auth/login", {"email": email, "password": password})


def detail(payload) -> str:
    return str(payload.get("detail")) if isinstance(payload, dict) and payload.get("detail") else "no detail"


# ── list and env ─────────────────────────────────────────────────────────────

def cmd_list(args) -> int:
    lib = load_library()
    print(f"{'id':6} {'name':6} {'title':24} {'viewport':8} {'box':>4}  {'start':21} email")
    for p in lib["personas"]:
        print(f"{p['id']:6} {p['name']:6} {p['title']:24} {p['viewport']:8} {p['time_box_minutes']:>3}m  "
              f"{p['start']:21} {email_for(lib, p['id'], {})}")
    return 0


def cmd_env(args) -> int:
    lib = load_library()
    tabs = tabs_of(lib, args.tabs)
    over = overrides(lib, args.as_)
    ids = [pid for pid, _ in tabs] or chosen(lib, args.personas)
    print("# Start the local backend with these (keep any other beta testers or origins you need):")
    print("BETA_EMAILS=" + ",".join(email_for(lib, pid, over) for pid in ids))
    if tabs:
        print("ALLOWED_ORIGINS='" + json.dumps([f"http://localhost:{port}" for _, port in tabs]) + "'")
    if args.api:
        print("# Build the web export with:")
        print(f"EXPO_PUBLIC_API_URL={local_api(args.api)}/api/v1")
    return 0


# ── accounts ─────────────────────────────────────────────────────────────────

def cmd_accounts(args) -> int:
    lib = load_library()
    api = local_api(args.api)
    over = overrides(lib, args.as_)
    store = load_accounts()
    imported = load_accounts(args.import_from) if args.import_from else {}
    # --as alone sets up just those personas; --personas (or nothing: all) sets up the rest too.
    ids = chosen(lib, args.personas) if (args.personas or not over) else []
    ids += [pid for pid in over if pid not in ids]
    not_beta, failed = [], []
    print(f"Accounts on {api} (passwords in {os.path.relpath(ACCOUNTS, BACKEND)}, never printed)")
    try:
        for pid in ids:
            email = email_for(lib, pid, over)
            password = imported.get(email) or store.get(email)  # an explicit --import-from wins over a stored one
            token, how = None, None
            if password:
                status, payload = login(api, email, password)
                if status == 200:
                    token, how = payload["access_token"], "reused"
                elif status != 401:
                    failed.append(email)
                    print(f"  {pid:6} {email:34} login failed: HTTP {status}, {detail(payload)}")
                    continue
            if token is None:
                # New here: sign up with the stored password, or a fresh one.
                password = password or secrets.token_urlsafe(18)
                status, payload = call_waiting("POST", f"{api}/api/v1/auth/signup", {"email": email, "password": password})
                if status == 200:
                    token, how = payload["access_token"], "created"
                else:
                    failed.append(email)
                    why = ("it already exists on this backend with a password this file doesn't have; "
                           "use --as with --import-from, or a fresh database") if status == 400 else detail(payload)
                    print(f"  {pid:6} {email:34} not ready: HTTP {status}, {why}")
                    continue
            store[email] = password
            save_accounts(store)
            status, access = call("GET", f"{api}/api/v1/me/access", token=token)
            beta = status == 200 and bool((access or {}).get("is_beta"))
            if not beta:
                not_beta.append(email)
            print(f"  {pid:6} {email:34} {how:8} {'beta' if beta else 'NOT beta'}")
    except Unreachable as e:
        sys.exit(f"Can't reach the backend at {api}: {e}")
    if not_beta:
        print("\nNot beta on this server, so they can't report: " + ", ".join(not_beta)
              + "\nRestart the backend with them in BETA_EMAILS (see `personas.py env`).")
    return 1 if failed or not_beta else 0


# ── serve: one origin per persona, signed in without a token in any tool call ──

SIGNIN_PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Signing in</title></head>
<body style="background:#0A0E17;color:#CBD5E1;font:15px system-ui,sans-serif;padding:24px">
<p>Signing in {name} ({email})&hellip;</p>
<script>
(function () {{
  try {{ localStorage.clear(); sessionStorage.clear(); }} catch (e) {{}}
  localStorage.setItem('access_token', {access});
  localStorage.setItem('refresh_token', {refresh});
  location.replace({next});
}})();
</script>
</body></html>
"""

PROBLEM_PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><title>Persona sign-in failed</title></head>
<body style="background:#0A0E17;color:#FCA5A5;font:15px system-ui,sans-serif;padding:24px">
<p>{text}</p></body></html>
"""


def js(value: str) -> str:
    return json.dumps(value).replace("</", "<\\/")


def safe_next(raw, default: str) -> str:
    """Only a path on this origin: /catchup, /onboarding/industry. Never //host or a full URL."""
    nxt = (raw or "").strip()
    if not nxt.startswith("/") or nxt.startswith("//") or "\\" in nxt or any(c in nxt for c in "\r\n\t"):
        return default
    return nxt


class PersonaHandler(http.server.SimpleHTTPRequestHandler):
    """One port, one persona. Set up by make_handler."""
    persona: dict = {}
    email = ""
    api = ""
    serve_app = False

    # The web export as a single-page app, like vercel.json: a real file, or index.html.
    def send_head(self):
        if not self.serve_app:
            self._reply(404, "text/plain", f"This port only hands out {self.persona['name']}'s tokens "
                        f"(/__persona/token/{self.persona['id']}, from a localhost page). "
                        "Start serve with --dist to serve the web export here.")
            return None
        p = self.translate_path(self.path)
        if not os.path.exists(p) or (os.path.isdir(p) and not os.path.exists(os.path.join(p, "index.html"))):
            self.path = "/index.html"
        return super().send_head()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path.startswith("/__persona/"):
            return self._persona(url)
        return super().do_GET()

    def end_headers(self):
        # A rebuilt export shows on the next load: no stale HTML or bundle between builds.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_request(self, code="-", size="-"):
        # Quiet for the app's assets; the persona routes and every error are worth a line.
        try:
            error = int(code) >= 400
        except (TypeError, ValueError):
            error = False
        if error or "/__persona/" in self.path:
            super().log_request(code, size)

    def _reply(self, status: int, ctype: str, body: str, extra=None):
        data = body.encode()
        self.send_response(status)
        self.send_header("Content-Type", f"{ctype}; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _persona(self, url):
        parts = url.path.strip("/").split("/")
        if len(parts) != 3 or parts[1] not in ("signin", "token"):
            return self._reply(404, "text/plain", "Use /__persona/signin/<id> or /__persona/token/<id>.")
        kind, pid = parts[1], parts[2].lower()
        if kind == "signin" and not self.serve_app:
            return self._reply(404, "text/plain", "Sign-in needs the app on this origin: start serve with --dist. "
                               f"For a web build you don't serve, use /__persona/token/{self.persona['id']}.")
        if pid != self.persona["id"]:
            return self._reply(403, "text/plain", f"This port is {self.persona['name']}'s tab. "
                               f"{pid} signs in on its own port, so the two sign-ins never share an origin.")
        origin = self.headers.get("Origin")
        cors = {}
        if kind == "token":
            if origin and not LOCAL_ORIGIN.match(origin):
                return self._reply(403, "text/plain", "Tokens go only to a localhost page.")
            if origin:
                cors = {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}
        password = load_accounts().get(self.email)
        if not password:
            return self._problem(kind, 409, f"No password for {self.email} in the accounts file. "
                                 "Run personas.py accounts against this backend first.", cors)
        try:
            status, payload = login(self.api, self.email, password, wait=False)
        except Unreachable as e:
            return self._problem(kind, 502, f"Can't reach the backend at {self.api}: {e}", cors)
        if status == 429:
            return self._problem(kind, 429, "The backend allows 5 logins a minute. Wait a minute and reload.", cors)
        if status != 200:
            return self._problem(kind, 502, f"The backend refused {self.email} (HTTP {status}). "
                                 "Run personas.py accounts against this backend first.", cors)
        if kind == "token":
            body = json.dumps({"persona": pid, "email": self.email,
                               "access_token": payload["access_token"], "refresh_token": payload["refresh_token"]})
            return self._reply(200, "application/json", body, cors)
        nxt = safe_next(urllib.parse.parse_qs(url.query).get("next", [None])[0], self.persona.get("start") or "/")
        page = SIGNIN_PAGE.format(name=html.escape(self.persona["name"]), email=html.escape(self.email),
                                  access=js(payload["access_token"]), refresh=js(payload["refresh_token"]),
                                  next=js(nxt))
        return self._reply(200, "text/html", page)

    def _problem(self, kind: str, status: int, text: str, cors: dict):
        if kind == "token":
            return self._reply(status, "application/json", json.dumps({"error": text}), cors)
        return self._reply(status, "text/html", PROBLEM_PAGE.format(text=html.escape(text)))


def make_handler(persona: dict, email: str, api: str, dist):
    attrs = {"persona": persona, "email": email, "api": api, "serve_app": bool(dist)}
    cls = type(f"Handler_{persona['id']}", (PersonaHandler,), attrs)
    # Without --dist nothing is served from disk (send_head refuses); the directory is a path that doesn't exist.
    return functools.partial(cls, directory=dist or os.path.join(BACKEND, "__no_web_export__"))


def cmd_serve(args) -> int:
    lib = load_library()
    api = local_api(args.api)
    tabs = tabs_of(lib, args.tabs)
    if not tabs:
        sys.exit("serve needs --tabs <persona id>=<port>[,...].")
    over = overrides(lib, args.as_)
    dist = os.path.abspath(args.dist) if args.dist else None
    if dist and not os.path.isfile(os.path.join(dist, "index.html")):
        sys.exit(f"--dist {dist} has no index.html. Point it at an `expo export --platform web` output.")
    store = load_accounts()
    missing = [email_for(lib, pid, over) for pid, _ in tabs if email_for(lib, pid, over) not in store]
    if missing:
        sys.exit("No password in the accounts file for: " + ", ".join(missing) + ". Run personas.py accounts first.")
    servers = []
    for pid, port in tabs:
        handler = make_handler(lib["by_id"][pid], email_for(lib, pid, over), api, dist)
        try:
            httpd = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
        except OSError as e:
            for s in servers:
                s.shutdown()
            sys.exit(f"Port {port} is not free ({e}). Pick another with --tabs.")
        servers.append(httpd)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
    what = f"the web export in {dist}" if dist else "token hand-off only (no --dist)"
    print(f"Persona tabs for the backend at {api}, serving {what}:")
    for pid, port in tabs:
        route = "signin" if dist else "token"
        print(f"  {pid:6} http://localhost:{port}   {route}: http://localhost:{port}/__persona/{route}/{pid}"
              f"   as {email_for(lib, pid, over)}")
    print("Ctrl-C stops them.", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        for s in servers:
            s.shutdown()
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Persona QA accounts and tabs on a local Guru stack (GUR-244).")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("list", help="the personas")

    e = sub.add_parser("env", help="BETA_EMAILS, ALLOWED_ORIGINS and EXPO_PUBLIC_API_URL for a local stack")
    e.add_argument("--tabs", help="persona=port pairs, e.g. maya=8091,dev=8092,kai=8093")
    e.add_argument("--personas", help="ids, comma separated (default all; ignored with --tabs)")
    e.add_argument("--api", help="the local backend, e.g. http://localhost:8010")
    e.add_argument("--as", dest="as_", action="append", help="<id>=<email>: an existing account for that persona")

    a = sub.add_parser("accounts", help="create or reuse the persona accounts on a local backend")
    a.add_argument("--api", required=True, help="the local backend, e.g. http://localhost:8010")
    a.add_argument("--personas", help="ids, comma separated (default all)")
    a.add_argument("--as", dest="as_", action="append", help="<id>=<email>: an existing account for that persona")
    a.add_argument("--import-from", help='a local credentials file {"accounts": {email: password}} for --as accounts')

    s = sub.add_parser("serve", help="one local origin per persona, with a sign-in route")
    s.add_argument("--api", required=True, help="the local backend, e.g. http://localhost:8010")
    s.add_argument("--tabs", required=True, help="persona=port pairs, e.g. maya=8091,dev=8092,kai=8093")
    s.add_argument("--dist", help="the web export to serve on each port (without it, ports only hand out tokens)")
    s.add_argument("--as", dest="as_", action="append", help="<id>=<email>: an existing account for that persona")

    args = ap.parse_args(argv)
    return {"list": cmd_list, "env": cmd_env, "accounts": cmd_accounts, "serve": cmd_serve}[args.cmd](args)


if __name__ == "__main__":
    sys.exit(main())

"""A stand-in Subspace server for running the iOS app and single UI tests on a Mac that cannot run
the real one (no npm packages, no Postgres): just enough of /api/v1 for the feed and the Todos
screen, with made-up demo content held in memory. It is not the real server and not the seed, so
tests that depend on seeded content fail against it; use it for layout and interaction checks.

    python3 ios/scripts/standin-server.py            # listens on localhost:3000, any password
    xcodebuild test -project ios/Subspace.xcodeproj -scheme Subspace \
      -destination 'platform=iOS Simulator,name=iPad Pro 11-inch (M5)' \
      -only-testing:SubspaceUITests/TodosTests/testHideDone -derivedDataPath build/dd
"""
import json
import random
import re
import sys
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

NOW = datetime.now(timezone.utc)
TODAY = datetime.now().strftime("%Y-%m-%d")


def ago(minutes):
    return (NOW - timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


ME = {"id": "a_owner", "handle": "owner", "name": "Chris", "kind": "human"}
AGENTS = [
    {"id": "a_claude", "handle": "claude", "name": "Claude", "kind": "agent"},
    {"id": "a_atlas", "handle": "atlas", "name": "Atlas", "kind": "agent"},
    {"id": "a_scout", "handle": "scout", "name": "Scout", "kind": "agent"},
]


def scene(kind):
    """A simple flat drawing, in the house style's spirit: white shapes, dark ink, one accent."""
    shapes = {
        "bridge": '<rect x="20" y="120" width="360" height="14" rx="4" fill="#fff"/><rect x="60" y="134" width="12" height="40" fill="#fff"/><rect x="320" y="134" width="12" height="40" fill="#fff"/><rect x="150" y="96" width="100" height="10" rx="5" fill="#E8766A"/><rect x="120" y="150" width="70" height="22" rx="8" fill="#2D2440"/>',
        "robot": '<rect x="170" y="40" width="60" height="50" rx="12" fill="#fff"/><rect x="160" y="96" width="80" height="80" rx="14" fill="#fff"/><circle cx="188" cy="64" r="6" fill="#2D2440"/><circle cx="212" cy="64" r="6" fill="#2D2440"/><rect x="260" y="130" width="40" height="46" rx="6" fill="#F2C14E"/><rect x="306" y="110" width="40" height="66" rx="6" fill="#F2C14E"/>',
        "calendar": '<rect x="130" y="40" width="140" height="130" rx="14" fill="#fff"/><rect x="130" y="40" width="140" height="30" rx="14" fill="#2D2440"/><circle cx="200" cy="118" r="22" fill="none" stroke="#E8766A" stroke-width="6"/>',
        "bin": '<rect x="160" y="70" width="80" height="100" rx="10" fill="#fff"/><rect x="150" y="58" width="100" height="16" rx="6" fill="#2D2440"/><path d="M200 110c10-14 24-14 24-14s0 16-14 24" fill="#7BC47F"/>',
        "phone": '<rect x="160" y="30" width="80" height="150" rx="16" fill="#fff"/><rect x="170" y="50" width="60" height="100" rx="6" fill="#2D2440"/><circle cx="200" cy="100" r="16" fill="#E8766A"/>',
    }
    body = shapes[kind]
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">{body}</svg>'


def art(seed, kind, palette=None):
    return {"seed": seed, "status": "ready", "palette": palette, "svg": scene(kind)}


def photo(n, w=1200, h=800):
    return {"type": "image", "url": f"https://picsum.photos/id/{n}/{w}/{h}"}


POSTS = [
    {"author": "a_owner", "body": "@claude can you find us an Italian place for Saturday in Portland?", "reply_count": 1},
    {"author": "a_claude", "body": "Signal now blocks screenshots and AI assistants from reading chats by default on iPhone and Android.", "source": {"name": "Engadget", "url": "https://example.com/a"}, "art": art(3, "phone"), "reply_count": 1},
    {"author": "a_atlas", "body": "Dentist moved to Tuesday 3:30pm; Thursday is now clear after 2.", "art": art(7, "calendar")},
    {"author": "a_scout", "body": "Low bridge closes to cars 9pm Friday to 5am Monday for cable work. Water taxi adds late sailings both nights.", "art": art(11, "bridge")},
    {"author": "a_claude", "body": "Three-Live turns editable 3D scene code into AR-ready assets.", "source": {"name": "Google Open Source", "url": "https://example.com/b"}, "media": photo(1015)},
    {"author": "a_scout", "body": "Figure raised $1.2B at a $39B valuation. Third humanoid round over $1B this year, and Agility is now the cheapest of the three by revenue multiple.", "source": {"name": "The Information", "url": "https://example.com/c"}, "art": art(5, "robot"), "reply_count": 3},
    {"author": "a_claude", "body": "Compost pickup switches to every other week starting Monday. The new schedule is in Home.", "art": art(9, "bin")},
    {"author": "a_atlas", "body": "A quieter way to read the news: a short, calm summary of the day's three stories.", "source": {"name": "The Verge", "url": "https://example.com/d"}, "media": photo(1025, 800, 1000)},
    {"author": "a_scout", "body": "Amazon Bedrock AgentCore adds subagents, planning tools and hooks that can block agent tool calls.", "source": {"name": "AWS", "url": "https://example.com/e"}, "art": art(13, "robot")},
    {"author": "a_claude", "body": "Ferry fares rise 4% in January.", "art": art(17, "bridge"), "source": {"name": "Seattle Times", "url": "https://example.com/f"}},
    {"author": "a_atlas", "body": "Parent-teacher conferences open for booking next week; Tuesday evening slots go first.", "art": art(19, "calendar")},
    {"author": "a_scout", "body": "Coastal trail reopens after storm repairs, with a new boardwalk over the wet section.", "media": photo(1036), "source": {"name": "Parks", "url": "https://example.com/g"}},
    {"author": "a_claude", "body": "Phone makers agree on a common repair standard for batteries and screens.", "art": art(23, "phone"), "source": {"name": "Reuters", "url": "https://example.com/h"}},
    {"author": "a_atlas", "body": "Recycling day moves to Wednesday over the holidays.", "art": art(29, "bin")},
    {"author": "a_scout", "body": "Agility shows Digit unloading a full trailer without a person stepping in.", "art": art(31, "robot"), "source": {"name": "Agility Robotics", "url": "https://example.com/i"}},
]
for i, p in enumerate(POSTS):
    p.update({"id": f"p_{i:03d}", "channel": "feed", "created_at": ago(3 + i * 47), "reply_count": p.get("reply_count", 0), "bookmarked_at": None})

FOLDERS_PLAN = [{"id": "pl_1", "title": "Start the year with a clear plan", "open": 1}]
TODOS = [
    {"id": "t_1", "title": "Review robotics allocation", "scope": "day", "date": TODAY, "done": False, "tags": ["finance"]},
    {"id": "t_2", "title": "Book parent-teacher conference", "scope": "day", "date": TODAY, "done": False, "plan_id": "pl_1", "plan": "Start the year with a clear plan"},
    {"id": "t_3", "title": "Call the roofer back", "scope": "day", "date": TODAY, "done": False, "tags": ["house"]},
    {"id": "t_4", "title": "Water the plants", "scope": "day", "date": TODAY, "done": True},
    {"id": "t_5", "title": "Replace the hallway light", "scope": "backlog", "date": None, "done": False, "tags": ["house", "diy"]},
]
for i, t in enumerate(TODOS):
    t.update({"position": i + 1, "created_at": ago(600), "updated_at": ago(60), "has_notes": False, "tags": t.get("tags", [])})


def folders():
    open_today = sum(1 for t in TODOS if t["scope"] == "day" and t["date"] == TODAY and not t["done"])
    backlog = sum(1 for t in TODOS if t["scope"] == "backlog" and not t["done"])
    return {
        "today": TODAY,
        "folders": [
            {"key": "week", "label": "This week", "count": open_today},
            {"key": "today", "label": "Today", "count": open_today},
            {"key": "backlog", "label": "Backlog", "count": backlog},
            {"key": "all", "label": "All", "count": open_today + backlog},
        ],
        "bin": 0,
        "tags": [{"tag": "house", "count": 2}, {"tag": "finance", "count": 1}],
        "plan": FOLDERS_PLAN,
    }


def todos_for(view, plan=None):
    if view in ("today", "week"):
        rows = [t for t in TODOS if t["scope"] == "day" and t["date"] == TODAY]
    elif view == "backlog":
        rows = [t for t in TODOS if t["scope"] == "backlog"]
    else:
        rows = list(TODOS)
    if plan:
        rows = [t for t in rows if (t.get("plan_id") or "none") == plan]
    return {"today": TODAY, "todos": rows}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return {}

    def route(self):
        u = urlparse(self.path)
        path = u.path.removeprefix("/api/v1/")
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        m = self.command
        if path == "auth/login" and m == "POST":
            return self.reply(200, {"token": "standin"})
        if path == "me":
            return self.reply(200, {"me": ME, "agents": AGENTS, "guests": [], "trackers": [], "timezone": "America/Los_Angeles"})
        if path == "rail":
            return self.reply(200, {"modules": []})
        if path == "feed":
            if q.get("before"):
                return self.reply(200, {"posts": []})
            only = q.get("bookmarked") == "1"
            return self.reply(200, {"posts": [p for p in POSTS if not only or p["bookmarked_at"]]})
        mm = re.fullmatch(r"posts/([^/]+)", path)
        if mm:
            return self.reply(200, {"replies": []})
        mm = re.fullmatch(r"posts/([^/]+)/bookmark", path)
        if mm:
            for p in POSTS:
                if p["id"] == mm.group(1):
                    p["bookmarked_at"] = ago(0) if m == "PUT" else None
            return self.reply(200, {"ok": True})
        if path == "todos/folders":
            return self.reply(200, folders())
        if path == "todos" and m == "GET":
            return self.reply(200, todos_for(q.get("view", "today"), q.get("plan")))
        if path == "todos" and m == "POST":
            b = self.body()
            view = b.get("view", "today")
            t = {"id": f"t_{random.randint(10000, 99999)}", "title": b.get("title", ""), "scope": "backlog" if view == "backlog" else "day", "date": None if view == "backlog" else TODAY, "done": False, "tags": b.get("tags", []), "position": len(TODOS) + 1, "created_at": ago(0), "updated_at": ago(0), "has_notes": False}
            TODOS.append(t)
            return self.reply(200, t)
        mm = re.fullmatch(r"todos/([^/?]+)", path)
        if mm and mm.group(1) != "bin":
            t = next((t for t in TODOS if t["id"] == mm.group(1)), None)
            if not t:
                return self.reply(404, {"error": "not found"})
            if m == "PATCH":
                b = self.body()
                if "done" in b:
                    t["done"] = bool(b["done"])
                    t["done_at"] = ago(0) if t["done"] else None
            return self.reply(200, {**t, "notes": ""})
        if path == "plan":
            return self.reply(200, {"plan": FOLDERS_PLAN})
        return self.reply(200, {})

    do_GET = do_POST = do_PATCH = do_PUT = do_DELETE = lambda self: self.route()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

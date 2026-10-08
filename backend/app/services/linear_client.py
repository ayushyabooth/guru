"""
A small Linear client for Report a bug: find the team, find or create a label,
create an issue, comment on it, rewrite its description. Plain GraphQL over
httpx, 10 seconds per call.

LINEAR_API_KEY is a personal API key, sent as the Authorization header with no
"Bearer" (Linear's rule for personal keys). It is read at call time and never
logged; errors carry Linear's own message and code, with the key scrubbed out.
Linear answers some failures with HTTP 200 and an "errors" list, and rate limits
with HTTP 400 and code RATELIMITED, so every response body is checked.

Tests swap _client() for an httpx.MockTransport, or patch the five functions.
"""
import os

import httpx

API_URL = "https://api.linear.app/graphql"
TIMEOUT_S = 10

TEAM_QUERY = "query Team($key: String!) { teams(filter: {key: {eq: $key}}) { nodes { id key } } }"
LABELS_QUERY = ("query Labels($name: String!) { issueLabels(filter: {name: {eqIgnoreCase: $name}}) "
                "{ nodes { id name isGroup retiredAt team { id } } } }")
CREATE_LABEL = ("mutation CreateLabel($input: IssueLabelCreateInput!) "
                "{ issueLabelCreate(input: $input) { success issueLabel { id } } }")
CREATE_ISSUE = ("mutation CreateIssue($input: IssueCreateInput!) "
                "{ issueCreate(input: $input) { success issue { id identifier url } } }")
CREATE_COMMENT = ("mutation CreateComment($input: CommentCreateInput!) "
                  "{ commentCreate(input: $input) { success comment { id url } } }")
UPDATE_ISSUE = ("mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) "
                "{ issueUpdate(id: $id, input: $input) { success issue { id } } }")

_team_ids = {}  # team key -> id, resolved once per process


class LinearError(Exception):
    pass


def _client() -> httpx.Client:
    return httpx.Client(timeout=TIMEOUT_S)


def _first_error(errors) -> str:
    e = errors[0] if errors and isinstance(errors[0], dict) else {}
    ext = e.get("extensions") or {}
    msg = ext.get("userPresentableMessage") or e.get("message") or "error"
    return f"{msg} ({ext['code']})" if ext.get("code") else msg


def _graphql(query: str, variables: dict) -> dict:
    key = (os.getenv("LINEAR_API_KEY") or "").strip()
    if not key:
        raise LinearError("LINEAR_API_KEY is not set")
    try:
        with _client() as c:
            r = c.post(API_URL, json={"query": query, "variables": variables},
                       headers={"Authorization": key, "Content-Type": "application/json"})
    except httpx.HTTPError as e:
        raise LinearError(f"{type(e).__name__} calling Linear: {e}".replace(key, "***")) from None
    try:
        body = r.json()
    except ValueError:
        body = {}
    body = body if isinstance(body, dict) else {}
    if body.get("errors") or r.status_code >= 400:
        detail = _first_error(body.get("errors")) if body.get("errors") else r.reason_phrase
        raise LinearError(f"HTTP {r.status_code}: {detail}".replace(key, "***"))
    return body.get("data") or {}


def resolve_team(key: str) -> str:
    """The team's id from its key (GUR), looked up once per process."""
    if key not in _team_ids:
        nodes = (_graphql(TEAM_QUERY, {"key": key}).get("teams") or {}).get("nodes") or []
        if not nodes:
            raise LinearError(f"No Linear team with key {key}")
        _team_ids[key] = nodes[0]["id"]
    return _team_ids[key]


def find_or_create_label(team_id: str, name: str) -> str:
    """A label the team can use (its own or a workspace label), created on the team when missing.
    Group and retired labels can't go on an issue, so they don't count."""
    nodes = (_graphql(LABELS_QUERY, {"name": name}).get("issueLabels") or {}).get("nodes") or []
    for n in nodes:
        team = (n.get("team") or {}).get("id")
        if not n.get("isGroup") and not n.get("retiredAt") and team in (None, team_id):
            return n["id"]
    out = _graphql(CREATE_LABEL, {"input": {"name": name, "teamId": team_id}}).get("issueLabelCreate") or {}
    label = out.get("issueLabel") or {}
    if not out.get("success") or not label.get("id"):
        raise LinearError(f"Linear did not create the label {name}")
    return label["id"]


def create_issue(team_id: str, title: str, description: str, label_ids=()) -> dict:
    out = _graphql(CREATE_ISSUE, {"input": {"teamId": team_id, "title": title, "description": description,
                                            "labelIds": list(label_ids)}}).get("issueCreate") or {}
    issue = out.get("issue") or {}
    if not out.get("success") or not issue.get("id"):
        raise LinearError("Linear did not create the issue")
    return {"id": issue["id"], "identifier": issue.get("identifier"), "url": issue.get("url")}


def create_comment(issue_id: str, body: str) -> dict:
    out = _graphql(CREATE_COMMENT, {"input": {"issueId": issue_id, "body": body}}).get("commentCreate") or {}
    comment = out.get("comment") or {}
    if not out.get("success") or not comment.get("id"):
        raise LinearError("Linear did not create the comment")
    return {"id": comment["id"], "url": comment.get("url")}


def update_issue_description(issue_id: str, description: str) -> dict:
    """Replace the issue's whole description (Markdown)."""
    out = _graphql(UPDATE_ISSUE, {"id": issue_id, "input": {"description": description}}).get("issueUpdate") or {}
    issue = out.get("issue") or {}
    if not out.get("success") or not issue.get("id"):
        raise LinearError("Linear did not update the issue")
    return {"id": issue["id"]}

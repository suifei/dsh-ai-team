"""SkillOpt-Sleep — DeepSeek Harness (DSH) session harvesting.

DSH keeps one append-only event log per session at
``<DSH_HOME>/sessions/<key>/<sessionId>/session.v4.jsonl.zstd``. The JSONL is
zstd-compressed; it is decoded by ``dsh_decode.mjs`` under a Node runtime
(every DSH install ships one; Python's stdlib has no zstd before 3.14).

Schema (DSH session v4, ``packages/core/session/src/types.ts``):
  * line 1 is the header: ``{"type": "session", "version": 4, "id", "createdAt",
    "cwd", "parentSession"?, "origin"?}`` — ``cwd`` is the project the session
    was opened in;
  * every other line is ``{"type", "seq", "time" (epoch ms), "data"}``:
      - ``user/message``: ``data.content`` blocks plus ``data.source.kind`` —
        a human prompt or a host wake, or synthetic context (skill text,
        reminders) under other kinds, which is not user intent;
      - ``assistant/message``: ``data.message.content`` blocks — ``text`` is
        kept, ``reasoning`` (private) is skipped;
      - ``tool/call``: ``data.name`` (arguments are never copied).

AI-team member sessions are ordinary DSH sessions opened in the team's
workspace, so they match the invoked project like any other session.

This module performs NO writes and NO network calls.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from typing import Any, Iterator, List, Optional

from skillopt_sleep.harvest import (
    _detect_feedback,
    _is_headless_replay,
    _is_meta_prompt,
    _project_matches,
    _text_from_content,
)
from skillopt_sleep.staging import redact_secrets
from skillopt_sleep.types import SessionDigest

SESSION_FILE = "session.v4.jsonl.zstd"
DECODER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dsh_decode.mjs")
# ``user/message`` sources that carry intent (counted on il2c, 11-16: a member
# session holds 1 ``user`` prompt and 37 ``agent-message`` relays):
#   * ``user`` — the human's own prompt;
#   * ``agent-message`` — messages relayed from another session; AI-team task
#     wakes reach members this way ("Agent lead sent a message: … Team event: …");
#   * ``ai-team`` — the plugin's in-turn correction (e.g. an action deferred to a
#     clock time); it is kept and also recorded as negative feedback, because it
#     marks the preceding reply as the wrong way to work.
# Host bookkeeping (``time-context``, ``runtime-context``, ``skill-catalog``,
# ``agent-instructions``, ``subagent-settled``, ``tool-jobs``, …) is not intent.
_INTENT_SOURCES = {"", "user", "agent-message", "ai-team"}
_RELAY_PREFIX = re.compile(r"^Agent \S+ sent a message:\s*")
# AI-team activation prompts start with the member's identity block
# (``memberIdentity`` in lib/domain/member-profile.js: "你是 <名>（<角色>）。"
# plus personality / skills / notes lines, then a blank line, then the
# prompt). Mined as intent, the identity is what every member session "asks
# for" (il2c harvest, 11-16: 6 of 16 tasks were personalities). Only the part
# after the block is the request.
_IDENTITY_HEAD = re.compile(r"^你是 [^\n]+（[^\n]*）。\n")


def _strip_member_identity(text: str) -> str:
    if not _IDENTITY_HEAD.match(text):
        return text
    _block, sep, rest = text.partition("\n\n")
    return rest.strip() if sep else ""
# Host bookkeeping the loop delivers as user messages.
_HOST_NOISE = re.compile(
    r"^(?:Time sampled while preparing turn|The working directory changed from|<system-reminder>)"
)


class DshSourceError(RuntimeError):
    """The DSH source cannot run (no usable Node runtime)."""


def resolve_node(configured: str = "") -> str:
    """Node used to decode sessions: config ``dsh_node`` > ``DSH_NODE`` > PATH."""
    for candidate in (configured, os.environ.get("DSH_NODE", "")):
        if candidate:
            return candidate
    found = shutil.which("node")
    if found:
        return found
    raise DshSourceError(
        "transcript_source 'dsh' needs a Node runtime (>= 22.15) to decode DSH sessions: "
        "set dsh_node in ~/.skillopt-sleep/config.json or DSH_NODE "
        "(DSH ships one at <install>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe)"
    )


def _iso_local(ms: Any) -> str:
    if not isinstance(ms, (int, float)) or isinstance(ms, bool):
        return ""
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(ms / 1000.0))


def _since_epoch(since_iso: Optional[str]) -> Optional[float]:
    if not since_iso:
        return None
    try:
        return time.mktime(time.strptime(since_iso[:19], "%Y-%m-%dT%H:%M:%S"))
    except (ValueError, OverflowError):
        return None


def _decoded_lines(node: str, path: str) -> Iterator[dict]:
    """Stream the session's JSON records; closing the generator stops Node."""
    proc = subprocess.Popen(
        [node, DECODER, path],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            raw = raw.strip()
            if not raw:
                continue
            try:
                record = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, ValueError):
                # A session still being written ends in a partial line.
                continue
            if isinstance(record, dict):
                yield record
    finally:
        if proc.poll() is None:
            proc.kill()
        if proc.stdout is not None:
            proc.stdout.close()
        proc.wait()


def _dedup(xs: List[str]) -> List[str]:
    seen: set = set()
    out: List[str] = []
    for x in xs:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def digest_dsh_session(path: str, *, node: str, project: str = "") -> Optional[SessionDigest]:
    """Build a :class:`SessionDigest` from one DSH session log.

    With ``project`` set, the header's ``cwd`` is checked first and the rest of
    the log is never decoded for sessions of other projects.
    """
    records = _decoded_lines(node, path)
    try:
        header = next(records, None)
        if not isinstance(header, dict) or header.get("type") != "session":
            return None
        cwd = header.get("cwd") if isinstance(header.get("cwd"), str) else ""
        # An empty cwd would resolve against the engine's own working directory.
        if project and (not cwd or not _project_matches(cwd, "invoked", project)):
            return None
        session_id = str(header.get("id") or os.path.basename(os.path.dirname(path)))
        started = _iso_local(header.get("createdAt"))
        ended = started
        user_prompts: List[str] = []
        assistant_finals: List[str] = []
        tools: List[str] = []
        feedback: List[str] = []
        n_user = 0
        n_asst = 0
        for rec in records:
            stamp = _iso_local(rec.get("time"))
            if stamp:
                ended = stamp
            rtype = rec.get("type")
            data = rec.get("data") if isinstance(rec.get("data"), dict) else {}
            if rtype == "user/message":
                source = data.get("source") if isinstance(data.get("source"), dict) else {}
                kind = str(source.get("kind") or "")
                if kind not in _INTENT_SOURCES:
                    continue
                text = str(redact_secrets(_text_from_content(data.get("content")))).strip()
                if kind == "agent-message":
                    text = _RELAY_PREFIX.sub("", text, count=1)
                text = _strip_member_identity(text)
                if not text or _HOST_NOISE.match(text) or _is_meta_prompt(text):
                    continue
                n_user += 1
                user_prompts.append(text)
                feedback.extend(_detect_feedback(text))
                if kind == "ai-team":
                    feedback.append("neg:ai-team-correction")
            elif rtype == "assistant/message":
                message = data.get("message") if isinstance(data.get("message"), dict) else {}
                n_asst += 1
                text = _text_from_content(message.get("content")).strip()
                if text:
                    assistant_finals.append(str(redact_secrets(text)).strip())
            elif rtype == "tool/call":
                name = data.get("name")
                if isinstance(name, str) and name:
                    tools.append(re.sub(r"[^A-Za-z0-9_.:-]+", "_", name)[:80])
    finally:
        records.close()

    if n_user == 0 and n_asst == 0:
        return None
    digest = SessionDigest(
        session_id=session_id,
        project=cwd,
        started_at=started,
        ended_at=ended,
        user_prompts=user_prompts,
        assistant_finals=assistant_finals[-5:],
        tools_used=_dedup(tools),
        files_touched=[],
        feedback_signals=_dedup(feedback),
        n_user_turns=n_user,
        n_assistant_turns=n_asst,
        raw_path=path,
    )
    if _is_headless_replay(digest):
        return None
    return digest


def harvest_dsh(
    sessions_dir: str,
    *,
    node: str = "",
    scope: Any = "all",
    invoked_project: str = "",
    since_iso: Optional[str] = None,
    limit: int = 0,
) -> List[SessionDigest]:
    """Walk ``<DSH_HOME>/sessions`` (newest first) and return digests.

    Parameters mirror :func:`skillopt_sleep.harvest.harvest`. Sessions whose log
    has not been written since ``since_iso`` are skipped without decoding.
    """
    digests: List[SessionDigest] = []
    if not os.path.isdir(sessions_dir):
        return digests
    node = resolve_node(node)
    since = _since_epoch(since_iso)

    paths: List[tuple[float, str]] = []
    for key in os.listdir(sessions_dir):
        key_dir = os.path.join(sessions_dir, key)
        if not os.path.isdir(key_dir):
            continue
        for session in os.listdir(key_dir):
            path = os.path.join(key_dir, session, SESSION_FILE)
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                continue
            if since is not None and mtime < since:
                continue
            paths.append((mtime, path))
    paths.sort(key=lambda item: item[0], reverse=True)

    project_hint = invoked_project if scope == "invoked" else ""
    for _mtime, path in paths:
        digest = digest_dsh_session(path, node=node, project=project_hint)
        if digest is None:
            continue
        if not _project_matches(digest.project or "", scope, invoked_project):
            continue
        if since_iso and digest.ended_at and digest.ended_at < since_iso:
            continue
        digests.append(digest)
        if limit and len(digests) >= limit:
            break
    return digests

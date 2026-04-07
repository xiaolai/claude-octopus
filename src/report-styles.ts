/**
 * CSS for the HTML report — extracted from report.ts.
 */

export const REPORT_CSS = `
:root {
  --bg: #0d1117; --surface: #161b22; --border: #30363d;
  --text: #e6edf3; --text-dim: #8b949e; --text-bright: #f0f6fc;
  --accent: #58a6ff; --green: #3fb950; --red: #f85149; --orange: #d29922;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font); background: var(--bg); color: var(--text); padding: 2rem; max-width: 1200px; margin: 0 auto; line-height: 1.5; }
h1 { color: var(--text-bright); margin-bottom: 0.5rem; }
h2 { color: var(--text-bright); font-size: 1.3rem; }
h3 { color: var(--text); font-size: 1rem; margin: 1rem 0 0.5rem; }
code { font-family: var(--mono); background: var(--surface); padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
pre { font-family: var(--mono); font-size: 0.8em; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
a { color: var(--accent); text-decoration: none; }
.subtitle { color: var(--text-dim); margin-bottom: 2rem; }

/* Run list table */
.run-table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
.run-table th, .run-table td { padding: 0.5rem 0.75rem; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.85rem; }
.run-table th { color: var(--text-dim); font-weight: 600; }
.run-table tbody tr:hover { background: var(--surface); }

/* Run detail */
.run { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.5rem; margin-bottom: 2rem; }
.run-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; }
.run-badge { font-size: 0.75rem; padding: 0.2em 0.6em; border-radius: 12px; font-weight: 600; }
.run-badge-ok { background: rgba(63,185,80,0.15); color: var(--green); }
.run-badge-error { background: rgba(248,81,73,0.15); color: var(--red); }

.run-stats { display: flex; gap: 2rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
.stat { text-align: center; }
.stat-val { font-size: 1.3rem; font-weight: 700; color: var(--text-bright); }
.stat-label { font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }

/* Timeline bar */
.timeline-bar { display: flex; align-items: center; gap: 0; margin-bottom: 1rem; padding: 0.5rem 0; }
.timeline-dot { width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: 700; color: var(--bg); flex-shrink: 0; }
.timeline-dot + .timeline-dot { margin-left: -1px; }
.timeline-dot::before { content: ""; position: absolute; }
.dot-ok { background: var(--green); }
.dot-error { background: var(--red); }
.timeline-dot + .timeline-dot { margin-left: 4px; }

/* Agent cards */
.agent-card { border: 1px solid var(--border); border-radius: 6px; padding: 1rem; margin-bottom: 0.75rem; background: var(--bg); }
.agent-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem; }
.agent-seq { width: 24px; height: 24px; border-radius: 50%; background: var(--accent); color: var(--bg); display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; flex-shrink: 0; }
.agent-name { font-weight: 700; font-size: 1rem; color: var(--text-bright); }
.agent-badge { font-size: 0.7rem; padding: 0.15em 0.5em; border-radius: 10px; font-weight: 600; }
.status-ok { background: rgba(63,185,80,0.15); color: var(--green); }
.status-error { background: rgba(248,81,73,0.15); color: var(--red); }
.agent-meta { display: flex; gap: 1rem; font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.5rem; flex-wrap: wrap; }
.session-id { font-family: var(--mono); font-size: 0.75rem; }
.agent-prompt { font-size: 0.85rem; color: var(--text-dim); font-style: italic; margin-bottom: 0.75rem; }

/* Transcript */
.transcript { margin-top: 0.5rem; }
.transcript > summary { cursor: pointer; font-size: 0.85rem; color: var(--accent); font-weight: 600; padding: 0.3rem 0; }
.transcript-body { margin-top: 0.5rem; max-height: 600px; overflow-y: auto; border: 1px solid var(--border); border-radius: 4px; padding: 0.5rem; }
.msg { padding: 0.5rem; border-bottom: 1px solid var(--border); }
.msg:last-child { border-bottom: none; }
.msg-role { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
.msg-user .msg-role { color: var(--accent); }
.msg-assistant .msg-role { color: var(--green); }
.msg-system .msg-role { color: var(--orange); }
.msg-content { font-size: 0.8rem; }
.text-block { margin-bottom: 0.5rem; white-space: pre-wrap; }
.tool-call { background: rgba(88,166,255,0.08); border: 1px solid rgba(88,166,255,0.2); border-radius: 4px; padding: 0.5rem; margin: 0.25rem 0; }
.tool-name { font-family: var(--mono); font-weight: 700; color: var(--accent); font-size: 0.8rem; }
.tool-input { margin-top: 0.25rem; color: var(--text-dim); font-size: 0.75rem; max-height: 200px; overflow-y: auto; }
.tool-result { background: rgba(63,185,80,0.05); border: 1px solid rgba(63,185,80,0.15); border-radius: 4px; padding: 0.5rem; margin: 0.25rem 0; }
.tool-result pre { color: var(--text-dim); font-size: 0.75rem; max-height: 200px; overflow-y: auto; }
.no-transcript { font-size: 0.8rem; color: var(--text-dim); font-style: italic; }
.empty { color: var(--text-dim); font-style: italic; }
`;

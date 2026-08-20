# Claude Agent SDK on the host as the grading engine

Free-form answers are graded by `@anthropic-ai/claude-agent-sdk` running in-process on the Raspberry Pi, authenticated by the machine's existing Claude subscription rather than an Anthropic API key. This is a two-person private application, and the subscription is already paid for.

## Consequences

The application is **bound to the machine holding the credentials**. `~/.claude` is read at call time, so the systemd unit must run as `dykmoby` with `HOME=/home/dykmoby`; any other service user fails every grading call with an error that does not present as an auth error. Moving the app to another host means moving or re-authenticating those credentials — it is not a matter of copying an environment variable.

Credentials can also expire, which would break grading for everyone at once and silently. This is why a periodic health check exists.

### The service also needs the box's outbound proxy — measured 2026-08-20

Proving this path under systemd (build-order step 2) turned up a second binding that is not about credentials at all. Outbound HTTPS from this box goes through a local proxy on `127.0.0.1:7890`. Interactive shells get `HTTP_PROXY`/`HTTPS_PROXY` from the profile; a systemd unit does not, and without them **every** Grader call fails with:

```
Failed to authenticate. API Error: 403 Request not allowed
```

Credentials were readable, unexpired, and owned by the right user throughout. This ADR predicted that the credentials failure would not present as an auth error; what actually happened is worse — a *network* failure presents as an auth error, and points an operator directly at the one thing that is not wrong.

So the unit needs `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` as well as `HOME`, and the health check distinguishes the two cases: credentials unreadable is reported as a likely credentials problem, an auth-shaped error with readable credentials as a likely egress problem. Both are phrased as guesses, because both are.

One consequence for anything else that talks to the internet from this box: the DuckDNS updater must go **without** the proxy, since DuckDNS records the source address of the request and would otherwise point the domain at the proxy.

## Considered options

Spawning `claude -p` as a subprocess per submission was measured first and works, but ~4-5s of every 16-19s call was process spin-up, and the CLI stalls a further 3s when stdin is not redirected. The SDK removes both, and adds `systemPrompt` override (deleting ~8-11k tokens of harness prompt that a grading call has no use for), tool disabling, typed streaming, and session resumption.

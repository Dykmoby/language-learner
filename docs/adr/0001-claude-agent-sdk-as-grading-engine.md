# Claude Agent SDK on the host as the grading engine

Free-form answers are graded by `@anthropic-ai/claude-agent-sdk` running in-process on the Raspberry Pi, authenticated by the machine's existing Claude subscription rather than an Anthropic API key. This is a two-person private application, and the subscription is already paid for.

## Consequences

The application is **bound to the machine holding the credentials**. `~/.claude` is read at call time, so the systemd unit must run as `dykmoby` with `HOME=/home/dykmoby`; any other service user fails every grading call with an error that does not present as an auth error. Moving the app to another host means moving or re-authenticating those credentials — it is not a matter of copying an environment variable.

Credentials can also expire, which would break grading for everyone at once and silently. This is why a periodic health check exists.

## Considered options

Spawning `claude -p` as a subprocess per submission was measured first and works, but ~4-5s of every 16-19s call was process spin-up, and the CLI stalls a further 3s when stdin is not redirected. The SDK removes both, and adds `systemPrompt` override (deleting ~8-11k tokens of harness prompt that a grading call has no use for), tool disabling, typed streaming, and session resumption.

# Grading is stateless; authoring is stateful

Grader calls never reuse a Claude session — each is a fresh, single-shot call carrying its own context. Authoring does the opposite: Refinement holds a persistent SDK session, resumed by id across page reloads.

The asymmetry is deliberate and will look inconsistent to a future reader, so: grading must be **reproducible and independently queueable**, and a session that accumulates a whole Lesson's worth of answers drifts, cannot be replayed, and complicates the concurrency limit. Authoring is the opposite kind of work — it is a conversation, and losing the thread on reload would make it useless.

Grading gets its quality from context, not memory: each call receives the Language, level, Lesson grammar focus, Reference Answer, Accepted Variants, and the Student's earlier attempts at that Exercise. The earlier attempts are what produce Progressive Hints, without any session state.

Refinement exchanges the **whole Draft** each turn rather than mutating one server-side through tool calls. Drafts are small, and full-document exchange eliminates an entire class of partial-mutation bugs while making every turn a restorable version for free.

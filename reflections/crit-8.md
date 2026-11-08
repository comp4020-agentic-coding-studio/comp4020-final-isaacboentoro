# Crit 8 — It's alive!

**What was the breakthrough that moved the work forward?**

The brief's three fixed requirements — multi-user, real-time, persists — are
easy to list and easy to fake with a demo that only looks real-time because
nobody's pushing on it. The breakthrough this week was deciding, before
writing the typing logic itself, that the server would own every fact about
a race: whose turn it is, how far anyone has typed, who finished and in what
order. The client would only ever render what it's told and report
keystrokes back
([`bb49141`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/bb49141)).
That's an architectural commitment, not a detail, and it's what let a
two-racer test
([`93a9242`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/93a9242))
mean something: a finish is refused if it arrives faster than physically
possible, because the server is doing the timing, not trusting whatever
number the page happens to send.

The other decision was to deploy on day one rather than treat deployment as
a later step: one Node process serves the page, the WebSocket and SQLite
together
([`785a97d`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-isaacboentoro/commit/785a97d)),
so there was never a point where "it works on my machine" was the only claim
I could make about it.

**What did this work change about who I want to be as a developer?**

I want to make the hard call early and let it shape everything after, rather
than leaving an architectural question open until it's inconvenient to
revisit. "The server decides" is one sentence, but it closed off a whole
category of bugs — forged scores, disagreeing clients — before they could
exist.

# Product

## Register

product

## Users

Novice and beginner investors who want to learn how markets work without risking
real money. They arrive curious but cautious — unsure what a "limit order" is, what
ROI means, or whether they'd panic-sell. Their context is exploratory and low-stakes:
practicing on a lunch break, testing a strategy, seeing what happens if a trade goes
wrong. The job to be done: **understand trading mechanics and build confidence** by
actually placing orders, watching live prices move, and seeing the honest consequences
in a virtual portfolio — then comparing progress on a leaderboard.

A secondary user is the returning practicer who already grasps the basics and wants a
realistic sandbox to rehearse strategies before using real capital.

## Product Purpose

Money-logix is a risk-free paper-trading and virtual-portfolio simulator. Users get
virtual cash, place MARKET and LIMIT orders against live (or simulated) market prices,
and watch their holdings, cash, P/L, and ROI update in real time — all backed by an
append-only, audit-grade ledger so the numbers are trustworthy and the mechanics are
real. A reset ("panic button") makes experimentation safe, and a leaderboard adds light
competition.

Success looks like a user who came in not knowing how a fill works and leaves able to
reason about orders, price movement, and portfolio value — having practiced enough that
the concepts stick. Engagement is earned through realistic feedback, not manufactured
urgency.

## Brand Personality

Confident, clear, guiding. The surface keeps the sleek dark trading-terminal aesthetic
(it should feel like a real desk, not a toy) but stays firmly learner-first: it teaches
as you go rather than assuming fluency. Voice is precise and calm — a knowledgeable
mentor, never a hype machine or a slot machine. Emotional goals: the user feels
**capable**, **safe to experiment**, and **motivated** to keep learning.

## Anti-references

- **Generic SaaS admin dashboard** — the interchangeable purple-gradient, rounded-card,
  hero-metric template that screams "AI made this." Money-logix has a committed
  identity (graphite terminal, yellow accent, green/red direction); it must not
  regress toward that anonymous admin look.
- Derived from the learner-first choice: avoid the **overwhelming day-trader terminal**
  (a wall of blinking panels a novice can't parse) and any **predatory / dopamine**
  patterns (loss-chasing nudges, urgency nags). Density and momentum are fine only when
  they serve understanding.

## Design Principles

1. **Teach through the interface.** Empty states, first-run moments, and inline hints
   turn every screen into a lesson. A blank portfolio should explain what to do next,
   not just say "nothing here."
2. **Honest feedback over hype.** Fills, P/L, ROI, and the ledger reflect real
   mechanics — no fake wins, no confetti for a loss. Trust is the product.
3. **Confidence without intimidation.** Reveal complexity progressively; a beginner
   should never face a wall of numbers. Density is earned, not the default.
4. **Legible at a glance.** Money, direction, and state must be readable instantly and
   never depend on color alone — direction cues (▲/▼, +/−, labels) accompany green/red.
5. **Safe to experiment.** It's a sandbox. Resetting, retrying, and undoing are obvious
   and low-stakes, so users feel free to make mistakes and learn from them.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**: body text ≥4.5:1 and large text ≥3:1 against its background;
visible keyboard focus (the app already defines `:focus-visible`); full keyboard
operability for orders, navigation, and the reset flow. Respect
`prefers-reduced-motion` with crossfade/instant alternatives for every animation.
Critically for a trading app, **gain/loss must never rely on color alone** — pair the
green/red with direction cues (arrows, +/− signs, or text) so red-green colorblind
users (~8% of men) can read every price change and P/L figure.

---
name: next-cache-components
description: Configure or debug Next.js Cache Components, cache lifetime and tag invalidation.
---

# Next.js Cache Components

Use for a task involving Cache Components, partial prerendering, `use cache`,
cache lifetime or tag invalidation. Confirm the installed Next.js version and
existing `cacheComponents` configuration first.

Search [REFERENCE.md](REFERENCE.md) for the affected topic (configuration,
static/cached/dynamic content, cacheLife, cacheTag, invalidation or migration),
then read that section alongside the corresponding installed Next.js docs.
Enabling Cache Components across an application is a separate configuration
change; ordinary page edits preserve current rendering behavior.

Verify the affected freshness, invalidation and Suspense behavior with the
project's existing checks. Keep authentication-dependent data out of shared
cache entries unless the key and access boundaries explicitly support it.

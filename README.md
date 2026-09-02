# OpenReview

An open-source, self-hosted AI code review bot. Deploy to Vercel, connect a GitHub App, and get on-demand PR reviews powered by Claude.

> **Beta**: OpenReview is currently in beta. It was built as an internal project to help the Vercel team test their technologies together. Expect rough edges and breaking changes.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?demo-description=An+open-source%2C+self-hosted+AI+code+review+bot.+Deploy+to+Vercel%2C+connect+a+GitHub+App%2C+and+get+automated+PR+reviews+powered+by+Claude.&demo-image=https%3A%2F%2Fopenreview.labs.vercel.dev%2Fopengraph-image.png&demo-title=openreview.labs.vercel.dev&demo-url=https%3A%2F%2Fopenreview.labs.vercel.dev%2F&from=templates&project-name=OpenReview&repository-name=openreview&repository-url=https%3A%2F%2Fgithub.com%2Fvercel-labs%2Fopenreview&env=GITHUB_APP_ID%2CGITHUB_APP_INSTALLATION_ID%2CGITHUB_APP_PRIVATE_KEY%2CGITHUB_APP_WEBHOOK_SECRET&products=%5B%7B%22integrationSlug%22%3A%22upstash%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22protocol%22%3A%22storage%22%2C%22type%22%3A%22integration%22%7D%5D&skippable-integrations=0)

## Features

- **Automatic reviews** — Reviews PRs when they are opened, reopened, marked ready, or updated
- **On-demand follow-ups** — Mention `@openreview` in any PR comment for additional instructions. Powered by [Chat SDK](https://chat-sdk.dev)
- **Sandboxed execution** — Runs in an isolated [Vercel Sandbox](https://vercel.com/docs/sandbox) with a credential-free checkout for linters, formatters, and tests
- **Actionable suggestions** — Posts concise findings and suggested fixes on the pull request
- **Read-only analysis** — Reviews source code without granting the model a GitHub credential
- **Reactions** — React with 👍 or ❤️ to request another pass, or 👎 or 😕 to skip
- **Durable workflows** — Built on [Vercel Workflow](https://vercel.com/docs/workflow) for reliable, resumable execution
- **Extensible skills** — Ships with built-in review [skills](https://skills.sh) and supports custom skills via `.agents/skills/`
- **Powered by Claude** — Uses Claude Sonnet 4.6 via the [AI SDK](https://sdk.vercel.ai) for high-quality code analysis
- **Simple route handler** — Easily define route handlers using [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers) for custom API endpoints and webhooks

## How it works

```mermaid
sequenceDiagram
    participant U as Developer
    participant GH as GitHub
    participant WH as Webhook Handler
    participant WF as Vercel Workflow
    participant SB as Vercel Sandbox
    participant AI as Claude Agent

    U->>GH: Open or update a pull request
    GH->>WH: Webhook event
    WH->>WF: Start workflow

    WF->>SB: Create sandbox
    WF->>SB: Load exact PR source snapshot
    SB->>SB: Install dependencies

    WF->>AI: Run agent with PR context
    AI->>SB: Read files, run linters, explore code
    SB-->>AI: Command output
    AI->>WF: Submit review result
    WF->>GH: Post review comment
    AI-->>WF: Agent complete

    WF->>SB: Stop sandbox

    U->>GH: React 👍 or ❤️ on suggestion
    GH->>WH: Reaction event
    WH->>WF: Start new workflow run
```

1. Open, reopen, mark ready, or update a pull request
2. OpenReview loads the exact PR source revision into a credential-free sandbox
3. A Claude-powered agent reviews the diff, explores the codebase, and runs project tooling
4. The workflow posts the agent's findings as a PR comment
5. The sandbox is cleaned up

## Setup

### 1. Deploy to Vercel

Click the button above or clone this repo and deploy it to your Vercel account.

### 2. Create a GitHub App

Create a new [GitHub App](https://github.com/settings/apps/new) with the following configuration:

**Webhook URL**: `https://your-deployment.vercel.app/api/webhooks`

**Repository permissions**:

- Contents: Read-only
- Issues: Read & write
- Pull requests: Read & write
- Metadata: Read-only

**Subscribe to events**:

- Issue comment
- Pull request
- Pull request review comment

Generate a private key and webhook secret, then note your App ID and Installation ID.

### 3. Configure environment variables

Add the following environment variables to your Vercel project:

| Variable                     | Description                                                            |
| ---------------------------- | ---------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`          | API key for Claude                                                     |
| `GITHUB_APP_ID`              | The ID of your GitHub App                                              |
| `GITHUB_APP_INSTALLATION_ID` | The installation ID for your repository                                |
| `GITHUB_APP_PRIVATE_KEY`     | The private key generated for your GitHub App (with `\n` for newlines) |
| `GITHUB_APP_WEBHOOK_SECRET`  | The webhook secret you configured                                      |
| `REDIS_URL`                  | (Optional) Redis URL for persistent state, falls back to in-memory     |

### 4. Install the GitHub App

Install the GitHub App on the repositories you want OpenReview to monitor. Ready pull requests are reviewed automatically, and mentions trigger additional reviews with specific instructions.

## Usage

**Automatic review**: Open, reopen, mark ready, or push new commits to a pull request.

**Request a follow-up review**: Comment `@openreview` on any PR. You can include specific instructions:

```
@openreview check for security vulnerabilities
@openreview run the linter and report any issues
@openreview explain how the authentication flow works
```

**Reactions**: React with 👍 or ❤️ on an OpenReview comment to request another pass. React with 👎 or 😕 to skip.

## Skills

OpenReview uses a progressive skill system — the agent only loads specialized instructions when relevant, keeping context focused and reviews thorough. Skills are discovered from `.agents/skills/` at runtime.

### Built-in skills

| Skill                         | Description                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `next-best-practices`         | File conventions, RSC boundaries, data patterns, async APIs, metadata, error handling |
| `next-cache-components`       | PPR, `use cache` directive, `cacheLife`, `cacheTag`, `updateTag`                      |
| `next-upgrade`                | Upgrade Next.js following official migration guides and codemods                      |
| `vercel-composition-patterns` | React composition patterns that scale for component refactoring                       |
| `vercel-react-best-practices` | React and Next.js performance optimization guidelines                                 |
| `vercel-react-native-skills`  | React Native and Expo best practices for performant mobile apps                       |
| `web-design-guidelines`       | Review UI code for Web Interface Guidelines and accessibility compliance              |

### Adding custom skills

Create a folder in `.agents/skills/` with a `SKILL.md` file containing YAML frontmatter:

```
.agents/skills/
└── my-custom-skill/
    └── SKILL.md
```

```markdown
---
name: my-custom-skill
description: When to use this skill — the agent reads this to decide whether to load it.
---

# My Custom Skill

Your specialized review instructions here...
```

The agent sees only skill names and descriptions in its system prompt. When a request matches a skill, it calls `loadSkill` to get the full instructions — keeping the context window clean.

## Tech stack

- [Next.js](https://nextjs.org) — App framework
- [Vercel Workflow](https://vercel.com/docs/workflow) — Durable execution
- [Vercel Sandbox](https://vercel.com/docs/sandbox) — Isolated code execution
- [AI SDK](https://sdk.vercel.ai) — AI model integration
- [Chat SDK](https://www.npmjs.com/package/chat) — GitHub webhook handling
- [Octokit](https://github.com/octokit/octokit.js) — GitHub API client

## Development

```bash
bun install
bun dev
```

## License

MIT

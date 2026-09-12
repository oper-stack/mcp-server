# @operstack/mcp

Let Claude, Cursor or any MCP client measure a site the way a search engine and an AI actually read it.

Ask your assistant *"why does ChatGPT recommend my competitor and not me?"* and it can now go and look: read the site, score six areas, follow the map the site offers to machines, and tell you what is actually missing. Free public signals only. No account, no API key, nothing stored.

## Install

In Claude Desktop, add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "operstack": {
      "command": "npx",
      "args": ["-y", "@operstack/mcp"]
    }
  }
}
```

In Cursor, add the same block to `.cursor/mcp.json` in your project, or to `~/.cursor/mcp.json` for every project.

Node 20 or newer. Nothing else to install.

## What it can do

**`audit_site`** reads a public site and scores six areas out of ten: technical SEO, content and structure, AEO (whether an answer engine can quote it), GEO (whether AI systems can identify and use it), off-page trust, and conversion. Returns every failing and borderline check with what was actually found on the pages, so the assistant can explain rather than guess.

**`check_llms_txt`** reads the site's `/llms.txt`, checks it against the format, and follows its links to see whether each one still leads to a page, a redirect or nothing. This file rots silently, because no human ever opens it.

**`compare_sites`** runs the same measurement on two to four sites and returns them side by side. Useful when the question is not *"am I bad"* but *"am I worse than them, and where"*.

**`run_gates`** runs the sixteen [OperStack content gates](https://www.npmjs.com/package/@operstack/gates) on a folder of Markdown or MDX on your own machine: cut titles, copied paragraphs, hollow sections, dead links, redirect chains, a stale agent index, figures with no source, and the agent surface. Files are read locally and sent nowhere.

## What it will not do

It will not invent a number. Where something was not measured it says so and why. It will not score a site on data that costs money: every figure comes from what any stranger can read on the site for nothing, which means you can reproduce it yourself. It will not report on a site that did not answer: a typo in the address gets a refusal, not a page of findings about nothing.

It keeps nothing. The address you check is used for the request and forgotten. There is no telemetry, no cache and no account.

## Why the numbers match the paid report

Every measurement here runs through [`@operstack/audit`](https://www.npmjs.com/package/@operstack/audit), the same package behind the paid OperStack reports. A free tool that disagrees with the paid one is the fastest way to lose the reader, so they are the same code.

## Related

- [Sixteen content gates](https://www.npmjs.com/package/@operstack/gates), free, MIT
- [Astro starter](https://github.com/oper-stack/astro-starter) that already passes them, free, MIT
- [Free llms.txt checker in the browser](https://oper-stack.com/tools/llms-txt-checker/)
- [Free AI visibility check](https://oper-stack.com/ai-visibility/)

MIT.

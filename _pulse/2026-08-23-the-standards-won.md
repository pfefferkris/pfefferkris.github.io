---
layout: pulse
title: "Pulse 001: The Standards Won"
description: The protocol layer of agentic AI consolidated under the Linux Foundation, skills became portable across tools, and the field's most popular project became its sharpest security warning.
date: 2026-08-23 12:00:00 -0400
---

This is the first entry in a weekly series. Each Monday, The Pulse covers the three most consequential things the agentic AI field shipped, takes one of them apart in more detail, and closes with a note on what is being built with those tools behind this practice.

## 1. The protocol layer grew up

The [Model Context Protocol](https://modelcontextprotocol.io/specification/2026-07-28), the standard that lets AI systems reach tools and data, now lives at the Linux Foundation alongside the rest of the interoperability stack. The [July 28 revision](https://blog.modelcontextprotocol.io/posts/2026-07-28/) made the protocol core stateless so servers scale like ordinary web services, hardened the authorization model, and moved long running work into extensions. Roughly four in ten software organizations now run MCP in production in some form, and the NSA and CISA have published [formal security guidance](https://media.defense.gov/2026/Jun/02/2003943289/-1/-1/0/CSI_MCP_SECURITY.PDF) for it. When intelligence agencies write hardening guides for a protocol, that protocol has become infrastructure.

## 2. Skills became portable

[Agent Skills](https://agentskills.io), the folder format that packages procedural knowledge for AI agents, is now an open standard read by roughly forty products, including every major coding agent. Independent benchmarks show curated skills lift agent task success by about sixteen percentage points. The lesson for anyone building with these tools: knowledge you write down once now travels with you across every product that reads the format, which changes where careful documentation pays off.

## 3. A warning about popularity

OpenClaw became the fastest growing repository in the history of GitHub this year. It also produced the field's sharpest security lesson: a [critical remote code execution flaw](https://www.armosec.io/blog/cve-2026-32922-openclaw-privilege-escalation-cloud-security/), more than 1,400 malicious skills discovered in its marketplace, and tens of thousands of exposed installations running insecure defaults. Stars measure attention, not engineering. The professional habit is to read the commit history, the issue tracker, and the security posture before adopting anything, no matter how loud the crowd around it is.

## The deep dive: why MCP matters to a small practice

A protocol becoming boring is the most useful thing that can happen to it. With the handshake gone and the core stateless, an MCP server is now just a well behaved web service, which means the tools a practice builds for itself, a document intake check, a rates lookup, a compliance scan, can be written once and reached from any AI product the practice uses now or adopts later. The research system behind this site speaks a custom API today; its tool layer maps almost one to one onto MCP, and adopting the standard has moved onto the build list here.

## What we are building

This week the work behind this site was a full audit of the practice's own agentic system against the field: model routing held under a monthly budget, an audit log covering every AI turn, an evaluation suite that gates every deploy, and a nightly consolidation loop that turns conversations into durable memory. The audit found genuine strengths in telemetry and evaluation discipline, and produced a hardening roadmap that is now scheduled engineering work rather than good intentions. Future entries will report that progress as it lands.

*The Pulse is compiled by the research pipeline behind this practice and reviewed before publication. Every claim links to source code or primary documentation.*

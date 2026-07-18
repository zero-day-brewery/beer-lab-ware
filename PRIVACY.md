# Privacy

Short version: **this app does not phone home.**

## What the app collects

Nothing. There is no telemetry, no analytics, no crash reporting, no account
system, and no server operated by this project that receives your data. The CI
badge in the README is the only thing that knows this project exists.

## Where your data lives

All brewery data — recipes, batches, readings, inventory, yeast lots, settings —
is stored in **your browser's local database** (IndexedDB and localStorage) on
your device. It leaves the device only when *you* export it, back it up, or
configure one of the optional integrations below.

## Optional: BYO-AI companion

If you configure the AI companion with your own API key, then **when you use it,
the data relevant to your question (for example recipes, batches, readings) is
sent directly from your browser to the provider you chose** — Anthropic, an
OpenAI-compatible endpoint, or a local model server. That transfer is governed by
your provider's data-processing terms, not by this project.

- Your API key is stored in your browser's localStorage.
- The key is deliberately **excluded from data exports and backups** so it can't
  leak through a shared dump file.
- Using a local model server (e.g. on your own machine) keeps AI traffic entirely
  off the internet.

## Optional: self-hosted sync

If you stand up the self-hosted sync daemon, your brewery data is sent to **your
own server** when syncing. Nobody else is in that path. You are the operator of
that server and of any logs it keeps.

## Hosted instances

If you use a copy of this app hosted by someone else (including any demo
instance), the host serves only static files — your brewery data still stays in
your browser. Like any web server, the host may see standard access logs (IP
address, user agent, pages requested). Read that operator's privacy statement if
this matters to you.

## Exports and backups

Backup files and exports contain your brewery data in plain form. Store and share
them accordingly.

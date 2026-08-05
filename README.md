# Trade Accelerator Vercel projects

This repository keeps every public bot and landing page separate. Each folder
under bots or pages is connected to its own Vercel Project and can have its own
domain, settings, environment variables and deployment history.

## Current projects

| Vercel project | Root Directory | Type | Suggested domain |
| --- | --- | --- | --- |
| Trade Accelerator Quick Map | bots/quick-map | Static interface plus one AI function | marketingmap.tradeacceleratorltd.com |
| CRS Roofing Calculator | pages/crs-roofing | Static HTML site | Your chosen CRS Roofing domain |

The longer Marketing Map and website-copy chat from the old download has not
been included.

## Repository structure

    bots/
      quick-map/
        api/chat.js
        assets/
        index.html
        package.json
        vercel.json

    pages/
      crs-roofing/
        assets/
        index.html
        package.json
        vercel.json

Each deployable folder is self-contained. Do not point a Vercel Project at the
repository root; select the individual bot or page folder as its Root Directory.

## Deploy Quick Map to Vercel

1. Push this complete repository to GitHub.
2. In Vercel, choose Add New, then Project, and import the GitHub repository.
3. Set Root Directory to bots/quick-map.
4. Use Framework Preset: Other.
5. Leave Build Command and Output Directory at their defaults.
6. Add the environment variables described below.
7. Deploy and test the generated vercel.app address.
8. Add marketingmap.tradeacceleratorltd.com under Domains.
9. Update the domain DNS using the exact record Vercel displays.
10. Remove the Render service only after the Vercel domain is working.

## Quick Map environment variables

Required:

- ANTHROPIC_API_KEY: the secret API key used to call Anthropic.

Optional:

- ANTHROPIC_MODEL: overrides the default model, claude-sonnet-4-6.

Add these in Vercel under Project Settings, Environment Variables. Apply the
required key to Production and Preview. Do not commit a real key to GitHub.
No PORT, VERCEL_TOKEN or GitHub token is required for normal Git deployments.

The API contains input validation and a basic per-instance request limit. For a
public production bot, also configure a Vercel Firewall rate-limit rule for
/api/chat. That protection is managed in Vercel and does not require another
environment variable.

## Deploy another page or bot

To add a landing page:

1. Copy pages/crs-roofing to pages/new-project-name.
2. Replace its HTML and assets.
3. Give its package.json a unique package name.
4. Import the same GitHub repository into a new Vercel Project.
5. Select pages/new-project-name as the Root Directory.
6. Add that project's custom domain.

To add another bot, copy bots/quick-map instead. Give it its own prompt and,
where appropriate, its own environment variables. Never put secret keys in the
HTML.

Run npm run check from the repository root before pushing changes.

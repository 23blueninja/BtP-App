# Private playtest build (unreleased material)

Notes for setting up a private, login-protected copy of the app that contains
unreleased rules. Nothing here has been set up yet.

## Why a separate copy

Anything committed to the public `BtP-App` repo is public, and so is its GitHub
Pages site. Unreleased material needs its own **private repo** and a host that
puts the site **behind a login**.

## Recommended setup: private repo + Cloudflare Pages + Cloudflare Access

### 1. Create a private copy of the repo

GitHub's **Fork** button won't work, because a fork of a public repo can't be
private. Instead, create an empty private repo on GitHub (for example
`BtP-App-Private`), then:

```sh
git clone https://github.com/23BLUENINJA/BtP-App.git BtP-App-Private
cd BtP-App-Private
git remote rename origin public
git remote add origin https://github.com/23BLUENINJA/BtP-App-Private.git
git push -u origin main
```

To bring later public changes into the private copy:

```sh
git pull public main
```

### 2. Add the unreleased rules (private repo only)

- Replace `rules/BtP-Alpha-Rules.md`, or add a new file and point the
  `parse-rules` script in `package.json` at it.
- Run `npm run parse-rules` to regenerate `src/content/rules.json`.
- Adjust the hand-written class mechanics in `src/data/` if new or changed
  classes need them.
- Commit and push to the private repo.

### 3. Host on Cloudflare Pages (free)

- Cloudflare dashboard → Workers & Pages → Create → Pages → connect to Git →
  pick the private repo.
- Build command: `npm run build`
- Output directory: `dist`
- No config changes are needed: the app builds with relative paths
  (`base: './'` in `vite.config.ts`), so it works on any host.

### 4. Lock it down with Cloudflare Access (Zero Trust, free up to 50 users)

- Zero Trust → Access → Applications → add a self-hosted application for the
  Pages domain (cover both `*.pages.dev` and any preview URLs).
- Add a policy that allows only specific email addresses (you and your
  playtesters).
- Visitors get a one-time code by email before the site loads.
- It still installs on Android as a PWA once you're logged in.

## Alternatives

- **Run it locally only:** `npm run dev` in the private copy, on your own machine.
  Simple, but you can't install it on a phone, because PWAs need HTTPS unless
  you're on localhost.
- **Netlify or Vercel password protection:** works the same way, but both are
  paid features.
- **GitHub Pages from a private repo:** hides the source code, but the site
  itself is still public unless you're on GitHub Enterprise. Not a good fit.

## Things to know

- **Saved characters don't carry over.** Characters are saved per website address,
  so the private site won't see the ones saved on the public site. Use **Export**
  and **Import** on the home screen to move them across.
- **Releasing material later:** when unreleased material becomes public, copy the
  rules file into the public repo and commit it there. The private repo picks it
  up with `git pull public main`.

# Releasing `@wbcom/i18n-ai`

Publishing is automated through GitHub Actions so 2FA never blocks a release.

## One-time setup — the npm token (does the 2FA bypass)

1. npmjs.com → **Access Tokens → Generate New Token**
   - **Classic → Automation** (bypasses 2FA by design), **or**
   - **Granular**, Read/Write, scope **@wbcom**, with **"Bypass two-factor authentication"** checked.
2. GitHub → this repo → **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `NPM_TOKEN`
   - Value: the token from step 1
3. Never commit the token. Treat any token pasted in chat/logs as burned — revoke it.

## Cut a release

```bash
npm version patch          # or minor / major — bumps package.json + tags
git push --follow-tags
gh release create vX.Y.Z --generate-notes
```

Publishing the GitHub Release triggers `.github/workflows/publish.yml`, which runs
`npm publish --access public --provenance` with `NODE_AUTH_TOKEN=${secrets.NPM_TOKEN}`.
You can also run it manually via **Actions → Publish to npm → Run workflow**.

## Manual fallback (no CI)

```bash
npm publish --access public --otp=NNNNNN      # NNNNNN = authenticator code
# or, with an automation token in ~/.npmrc:
npm publish --access public
```

## Versioning

Keep it semver. The first release is `0.1.0` (early, proven on jetonomy). Bump
minor for features (new engines, new validators), patch for fixes.

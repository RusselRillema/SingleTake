# Hosting SingleTake on GitHub Pages

## Included deployment process

`.github/workflows/pages.yml` runs on pushes to `main`, pull requests and manual dispatch. The build job runs Node tests, syntax/import checks, a full-history naming audit and the static build. Pull requests never deploy. Successful main-branch builds upload **only `dist/`** and deploy it through the `github-pages` environment.

Build jobs have read-only repository permissions. Deployment receives `pages: write` and `id-token: write`. No stored deployment token, paid hosting service or server backend is required by the workflow. GitHub-hosted runners install Node 22 through the official setup action; there are no application npm dependencies to install. The workflow uses verified official action major versions, and Dependabot checks action updates monthly.

The built page includes a content-security policy, self-hosted ES modules and relative worker URLs. Those URLs support `/SingleTake/`, rather than assuming the domain root. No model fixture, private asset, test screenshot, repository internals or development helper is copied into the public site. `asset-manifest.json` records file sizes and SHA-256 checksums.

## Publication status for this delivery

The connected GitHub integration can read the target repository, but write attempts returned **HTTP 403: Resource not accessible by integration**. The prepared commits are local only. No remote commit, Actions run or live site is claimed. User-level admin metadata does not establish that the integration has write permissions.

To publish through the integration, its installation must allow the repository and grant the necessary Contents and Workflows write permissions. Initial Pages setup also requires appropriate repository access. Do not place a token in the source tree or send one through chat.

## Preserve the supplied commit history

The source ZIP contains files only. The Git bundle contains the clean initial commit, the audited interaction upgrade, and the deployment commit. From a folder containing `SingleTake.bundle`, run:

```sh
git clone SingleTake.bundle SingleTake
cd SingleTake
npm run verify
```

Git must be installed. Node.js 22 or newer is required for local tools. The application's source still runs without a bundler or an npm installation.

## Publish with your authenticated GitHub CLI

Authenticate GitHub CLI using its normal browser-based flow, then configure Git to use that authentication:

```sh
gh auth login
gh auth setup-git
node tools/publish.mjs --dry-run --set-origin --pages
node tools/publish.mjs --set-origin --pages
```

The helper sets `origin` only when explicitly asked, requires a clean repository, reruns validation, checks the remote branch, and refuses non-fast-forward replacement. It pushes the existing commits, verifies the remote SHA, configures Pages for Actions through the official API, and requests a deployment. It does not force-push, expose a token, or report a requested deployment as live.

When a remote already contains unrelated commits, stop and review/integrate them instead of forcing this history over them. A protected branch may require a pull request. Permission or initial workflow-indexing errors are surfaced; no background completion is promised.

## Manual repository setup

Alternatively, preserve the bundle history and publish it normally:

```sh
git remote set-url origin https://github.com/RusselRillema/SingleTake.git
git push -u origin main
```

In the repository, open **Settings → Pages → Build and deployment → Source → GitHub Actions**. Then open **Actions → Verify and deploy SingleTake → Run workflow**, choosing `main`. Re-run after enabling Pages when the first push attempted deployment before that setting existed.

The intended project-site address after a successful deployment is:

```text
https://russelrillema.github.io/SingleTake/
```

This address is a target, not a verified live site for this delivery. Use the completed deployment job's URL as the source of truth.

## Check the result

```sh
gh run list --repo RusselRillema/SingleTake --workflow pages.yml
gh run view RUN_ID --repo RusselRillema/SingleTake --log-failed
```

A successful build alone is not a deployment. Confirm the deployment job succeeds, open its URL in a WebGPU-capable browser, verify the startup axes, create a face and extrude it, then open a local model. Device limitations remain independent of Pages success.

To inspect the exact built assets locally:

```sh
npm run build
npm run preview
```

Open the printed localhost URL. The optional real-GPU browser test can target the deployed URL with `--url`. CPU checks, static packaging and DOM tests do not prove GPU rendering correctness.

## Rollback and references

Use `git revert` on an unwanted change and push the revert; the same workflow redeploys the previous behavior without rewriting shared history. Browser-local recovery data and user model files are not deployment assets.

Official deployment reference: `https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages`.

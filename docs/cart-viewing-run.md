# Run the cart-viewing vertical slice

This increment implements a dedicated read-only cart page through the real React build, Express authentication/cart API and PostgreSQL queries. Server-calculated prices, line totals and subtotal are integer cents. Cart reads return active/empty/expired state, a persisted expiry reason, cart identity and version, and `Cache-Control: private, no-store`.

## Reproduce local acceptance checks

From the application root, using Node.js and pnpm:

```powershell
pnpm --dir backend install --frozen-lockfile
pnpm --dir frontend install --frozen-lockfile
node frontend/node_modules/vite/bin/vite.js build
node backend/test/cart-view.e2e.cjs
```

On Windows the harness uses the installed Microsoft Edge executable. Set `EDGE_EXECUTABLE` for a different installed compatible browser. On other systems install Chromium using the pinned Playwright CLI in `backend/node_modules/playwright/cli.js` before running. The test exits nonzero on a failed assertion.

The harness creates a unique file-backed PGlite database under ignored `.local/cart-uat/`, hashes a synthetic user's generated password, seeds two mugs and one mouse, serves the production frontend build through the actual Express application on an ephemeral loopback port, and signs in through the UI. It makes no browser-route mocks. A dependency-injected hook makes only the cart read fail, after authentication, and is rejected outside `NODE_ENV=test`. It is not a public failure-control endpoint.

Evidence is written to the run's `evidence/` directory: screenshots, sanitized response/saved-state snapshots, a JSON result report and SHA-256 source/build manifest. Set `EVIDENCE_DIR` to a desired evidence destination. Runtime credentials/tokens are never written to those reports. The backend and browser close at completion; the local database remains available as a synthetic artifact. Each rerun creates a fresh directory without overwriting or deleting previous runs.

PGlite is a file-backed embedded PostgreSQL development dependency ([official filesystem documentation](https://pglite.dev/docs/filesystems)). It runs actual SQL but is not a conventional deployed PostgreSQL server; normal backend startup still defaults to `pg` and DB environment variables. Production mode rejects the embedded engine. This run does not verify production deployment, multi-process database behaviour or independent business approval.

## Manual local use

With normal PostgreSQL available, run the backend and frontend normally. For a local embedded database, set `DB_ENGINE=pglite` and `PGLITE_DATA_DIR` to a dedicated local data directory before `node backend/server.js`, then run Vite from `frontend`. Authentication uses the actual register/login routes. Test fixtures are created by the harness, not a public seed endpoint.

No application-wide mutation workflow ships in this slice: catalog add controls are disabled, cart POST/DELETE and order submission return 501. This deliberately enforces the unresolved mutation-release gates. Read-only orders are unaffected. Token invalidation, quantity-update reconciliation and later checkout are not implemented by this slice.

## Narrow retention behaviour and limitations

On first read, a cart-state row is initialized if absent. Existing legacy lines have no reliable historical change timestamp; their retention window begins at that migration read rather than pretending their original age is known. Existing cart-state timestamps are not reset by ordinary reads or Retry.

On/after the stored 720-hour boundary, a transaction removes expired items and sets a persisted reason/version. Later reads keep the reason. Dismissal is local to the current cart view; a subsequent view/reload restores it. Clearing the reason on new successful additions awaits the mutation increment and was not tested here. No variants, historical-price notices, exact-boundary clock test or conflict/reconciliation semantics are claimed implemented.

The cart-state version is metadata for this read-only implementation, not proof of a completed optimistic-concurrency contract. All later mutations must update the state/retention/version consistently before those gates can close.

# Hello example integration

The reference t@sk4ce v1 integration service, in one stdlib-only file. Copy `server.py` to start your own. It is for local development and is never listed in the catalog.

What it does:

- Verifies every request: timestamp within 300 s, signature (constant-time compare), request id not seen before. Anything else gets `401`.
- Signs every reply over its exact bytes and echoes `request_id`.
- `poll`: marks every linked chore done for every linked kid ("always done"). The idempotency key is `<date>:<kid>:<chore>`, so it applies once a day.
- `widgets`: a parent card "Hello" with a poll counter and a "Mark done" button.
- `events`: a press of "Mark done" completes that kid's chores.
- `uninstall`: forgets the install.

Secrets are kept in memory only. A real service stores them encrypted and serves HTTPS on port 443.

## Run it

From the repo root (Python 3.11+, no packages needed):

```bash
python examples/integration-hello/server.py --port 8787
```

## Test it with the box simulator

In a second terminal, from the repo root, with the backend's Python environment:

```bash
cd backend
python -m app.integrations.simulator --manifest ../examples/integration-hello/manifest.json --dev
```

Every line should read `PASS` (or `SKIP` for a step the manifest does not use), ending with `All checks passed.` and exit code 0. Run some steps only with `--steps poll,widgets`. See the "Test with the simulator" section of [`docs/integrations/protocol-v1.md`](../../docs/integrations/protocol-v1.md) for what each step checks.

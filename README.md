# SMSService Workspace

This directory is the active workspace root for the SMSService stack.

It contains the canonical SMS runtime repository, deployment assets, browser-side helper scripts, and operator documentation entrypoints for the current stack.

## Active Layout

```text
SMSService/
├─ AIRead/                          -> linked operator knowledge base and secret notes
├─ deploy/                          -> workspace deployment assets
├─ docs/                            -> workspace-level documentation
├─ others/                          -> auxiliary long-lived tools such as browser runtime scripts
├─ repos/
│  └─ EasySMS/                      -> canonical SMS aggregation service
├─ .github/workflows/               -> CI/CD workflows
└─ local ignored temp/cache paths   -> generated only during local testing
```

## Current Responsibilities

- `repos/EasySMS`
  - external HTTP facade for SMS provisioning and receive flows
  - provider catalog / strategy / cooldown / health management
  - runtime bootstrap and file-driven configuration
- `deploy/EasySMS`
  - Docker build, compose, smoke, and GHCR publish assets
- `others/tampermonkey`
  - browser-local helper scripts for provider-side automation experiments
- `AIRead/部署/SMSService`
  - long-lived operator runbooks
- `AIRead/密钥/SMSService`
  - local-only secret reference materials

## Notes

- `AIRead` points to the shared operator knowledge base. Do not delete or silently rewrite secret-bearing materials.
- `repos/EasySMS` is initialized as an independent git repo inside the workspace. Once the canonical remote is finalized, it can be wired into the root repo as a formal submodule.
- Runtime bootstrap for EasySMS is file-driven:
  - config: `/etc/easy-sms/config.yaml`
  - state: `/var/lib/easy-sms`

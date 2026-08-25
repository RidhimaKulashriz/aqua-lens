# DRIFT Deployment Guide

## Managed application deployment

DRIFT is a Node.js full-stack application designed for the managed deployment environment. The web client and tRPC backend are built together, while database and object-storage credentials are injected by the platform. The app starts safely in demo mode without a physical drone or external ML service.

1. Run `pnpm check` and `pnpm test`.
2. Run the demo mission from the browser and verify defects, alerts, evidence, and report records.
3. Create a project checkpoint.
4. Use the project interface’s **Publish** control to expose the verified application. Do not publish a build before the checkpoint is created.

## Optional hardware deployment

Configure `DRIFT_HARDWARE_ENDPOINT` through the secret manager only after completing the documented bench test in `hardware_adapter_contract.md`. The endpoint is health-probed with a 3-second timeout and returns a retry state when unreachable. This setting does not add drone flight control.

## Optional ML deployment

Keep the built-in inference adapter for demo and fallback operation. For an external model service, deploy a HTTPS endpoint separately that accepts inspection media and returns a validated label, confidence, bounding box, and explainable severity inputs. Store its endpoint in `ML_INFERENCE_URL`; never place credentials in frontend code.

## CI

`.github/workflows/ci.yml` installs dependencies with a frozen lockfile, runs TypeScript validation, and executes Vitest for pushes and pull requests.


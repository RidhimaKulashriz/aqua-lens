# DRIFT Environment Template

Do not commit an `.env` file. Configure sensitive values through the deployment environment’s secret manager.

| Setting | Required | Example format | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | Managed | Platform-injected | Persistent MySQL/TiDB mission, defect, alert, audit, and report records. |
| `BUILT_IN_FORGE_API_URL` / `BUILT_IN_FORGE_API_KEY` | Managed | Platform-injected | Secure server-side AI, storage, map, and notification integrations. |
| `DRIFT_HARDWARE_ENDPOINT` | Optional | `https://bridge.example.org/health` | Operator-approved health endpoint for a compatible telemetry or media bridge. When omitted, DRIFT stays in simulator mode. |
| `ML_INFERENCE_URL` | Optional | `https://vision.example.org/infer` | Compatible external vision inference endpoint. The built-in explainable fallback adapter remains active when omitted. |

The hardware bridge must be set only after bench validation and a documented operator approval. DRIFT does not send any aircraft control commands.

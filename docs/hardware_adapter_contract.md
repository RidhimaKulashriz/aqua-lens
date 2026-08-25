# DRIFT Hardware Adapter Contract

DRIFT is an **ingestion and decision-support platform**, not a flight-control system. It must never be used to arm, launch, navigate, or otherwise command an aircraft. Compatible drone hardware is connected through an operator-approved bridge that sends telemetry and media to DRIFT after the operator has completed the vendor-specific safety and flight-control setup.

## Required telemetry fields

Use the authenticated `drift.ingestTelemetry` tRPC operation from a bridge service controlled by the organisation. The required payload is:

```json
{
  "missionId": 42,
  "latitude": 28.6139,
  "longitude": 77.2090,
  "altitude": 34.2,
  "speedMps": 7.8,
  "batteryPercent": 84,
  "timestamp": 1787656160000
}
```

The server validates coordinate types, non-negative altitude and speed, battery range, and timestamp before writing telemetry to the mission record. Invalid data is rejected. Every accepted event creates an audit entry.

## Media ingress

An operator uploads photos and video through the Evidence Vault, or a trusted integration service uses the documented authenticated evidence-upload operation. Files are stored in managed object storage and only the storage reference plus mission metadata are written to the database.

## Integration test sequence

1. Keep the aircraft disarmed and use a vendor simulator or bench bridge.
2. Create a DRIFT test mission in simulator mode.
3. Send one valid telemetry payload and verify the mission telemetry list updates.
4. Send a payload missing `batteryPercent` and verify the adapter rejects it.
5. Upload a test image and verify an evidence record is retained and available from the Evidence Vault.
6. Only after organisational flight approval may the same adapter be connected to live telemetry. DRIFT still provides no aircraft-control commands.

## Fallback

When `DRIFT_HARDWARE_ENDPOINT` is absent or a bridge is unhealthy, the dashboard marks the adapter offline or degraded and keeps simulator mode available. Health checks run on each requested adapter-status read with a 3-second timeout; unreachable or non-success endpoints return a **retrying** state with a 30-second operator retry guidance window. This is request-triggered retry behavior, not a hidden background process. It must not imply a live drone connection or generate flight commands.

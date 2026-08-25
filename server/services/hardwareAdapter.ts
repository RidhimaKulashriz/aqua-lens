export type HardwareStatus = "offline" | "connecting" | "connected" | "degraded" | "retrying";

export type HardwareConnection = {
  adapter: "http-webhook" | "mavlink-bridge" | "rtsp-media";
  status: HardwareStatus;
  endpoint?: string;
  lastHeartbeatAt?: number;
  retryAfterSeconds?: number;
  operatorMessage: string;
};

export function getHardwareConnection(endpoint?: string): HardwareConnection {
  if (!endpoint) {
    return {
      adapter: "http-webhook",
      status: "offline",
      operatorMessage: "No compatible hardware endpoint configured. Simulator mode is active and mission commands remain operator-controlled.",
    };
  }
  return {
    adapter: endpoint.includes("rtsp") ? "rtsp-media" : endpoint.includes("mavlink") ? "mavlink-bridge" : "http-webhook",
    status: "degraded",
    endpoint,
    retryAfterSeconds: 15,
    operatorMessage: "Endpoint is configured but not independently validated. DRIFT will not arm, launch, or control a drone; it accepts telemetry and media only after an operator-approved integration test.",
  };
}

export async function probeHardwareConnection(endpoint = process.env.DRIFT_HARDWARE_ENDPOINT): Promise<HardwareConnection> {
  const base = getHardwareConnection(endpoint);
  if (!endpoint) return base;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(endpoint, { method: "GET", signal: controller.signal, headers: { accept: "application/json,text/plain" } });
    clearTimeout(timeout);
    if (!response.ok) return { ...base, status: "retrying", retryAfterSeconds: 30, operatorMessage: `Hardware bridge responded ${response.status}. DRIFT will retry the health probe in 30 seconds; simulator mode remains available.` };
    return { ...base, status: "connected", lastHeartbeatAt: Date.now(), operatorMessage: "Hardware bridge health check responded. Telemetry and media still require operator-approved integration validation." };
  } catch {
    return { ...base, status: "retrying", retryAfterSeconds: 30, operatorMessage: "Hardware bridge could not be reached. DRIFT will retry on the next status request; simulator mode remains available." };
  }
}

export function validateTelemetryPayload(payload: unknown) {
  const value = payload as Record<string, unknown>;
  const required = ["latitude", "longitude", "altitude", "batteryPercent", "timestamp"];
  const missing = required.filter(key => value?.[key] === undefined);
  if (missing.length) return { valid: false, message: `Missing required telemetry fields: ${missing.join(", ")}` };
  if (typeof value.latitude !== "number" || typeof value.longitude !== "number") return { valid: false, message: "latitude and longitude must be numeric." };
  return { valid: true, message: "Telemetry payload passed adapter validation." };
}

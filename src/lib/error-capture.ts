import { reportOperationalError } from "./operational-errors.server";

export type ErrorStage =
  | "tenant_login"
  | "sync_cache"
  | "playback"
  | "realtime"
  | "r2_upload"
  | "rpc"
  | "server";

type ReportOptions = {
  stage: ErrorStage;
  reportCode: string;
  detail?: string;
  tenantToken?: string;
  deviceId?: string;
  crewSessionId?: string;
};

let lastCapturedError: Error | null = null;

export function consumeLastCapturedError(): Error | null {
  const error = lastCapturedError;
  lastCapturedError = null;
  return error;
}

export function captureSsrError(error: Error): void {
  lastCapturedError = error;
}

export async function captureError(options: ReportOptions): Promise<void> {
  try {
    await reportOperationalError({
      data: {
        tenantToken: options.tenantToken,
        error: {
          stage: options.stage,
          reportCode: options.reportCode,
          detail: options.detail?.slice(0, 1000) ?? null,
          deviceId: options.deviceId ?? null,
          crewSessionId: options.crewSessionId ?? null,
        },
      },
    });
  } catch {
    // Fire-and-forget — never block the UI
  }
}

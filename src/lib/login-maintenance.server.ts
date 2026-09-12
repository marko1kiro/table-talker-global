export class LoginMaintenanceError extends Error {
  readonly status = 503;
  readonly code = "LOGIN_MAINTENANCE" as const;

  constructor() {
    super("LOGIN_MAINTENANCE");
    this.name = "LoginMaintenanceError";
  }
}

export function requireLoginAvailable(): void {
  if (process.env.MAINTENANCE_MODE === "login_lock") throw new LoginMaintenanceError();
}

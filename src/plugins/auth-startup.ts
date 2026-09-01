import { getAuthSecret } from "../lib/auth.server";

/** Validate required auth configuration when the outer Nitro runtime starts. */
export default function validateAuthSecretAtStartup() {
  getAuthSecret();
}

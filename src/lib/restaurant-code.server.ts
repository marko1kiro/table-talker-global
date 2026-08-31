// Kode Resto is stored and matched as PLAIN TEXT (user decision, 2026-08-31:
// "gw mau KODE RESTO itu diperlakukan sebagai PLAIN TEXT. bukan PASSWORD/
// HASH."), reverting the 23-Aug hash+AES-encrypted redesign. This module
// used to also hold hashRestaurantCode/encryptRestaurantCode/
// decryptRestaurantCode/parseRestaurantCodeEncryptionKey; all of that was
// deleted along with the code_hash/code_encrypted columns and
// RESTAURANT_CODE_ENCRYPTION_KEY. redactCredentialAudit survives unchanged:
// audit logging (restaurant_credential_audit) was not targeted for removal,
// and a plain `code` field must still never be serialized into audit
// records.

function isCredentialField(key: string): boolean {
  return /^(code|code_hash|code_encrypted|credential|token|authorization|.*(?:token|bearer).*)$/i.test(
    key,
  );
}

export function redactCredentialAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentialAudit);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      isCredentialField(key) ? [] : [[key, redactCredentialAudit(entry)]],
    ),
  );
}

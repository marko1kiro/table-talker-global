export const TENANT_PIN = "123456";

const RESTAURANT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeRestaurantCode(
  value: string,
): { code: string } | { error: string } {
  const code = value.trim().toUpperCase();
  if (!code) return { error: "Kode resto wajib diisi." };
  if (!RESTAURANT_CODE_PATTERN.test(code))
    return { error: "Kode resto 3\u201332 karakter, huruf/angka/-/_ saja." };
  return { code };
}

export function validateTenantLogin(input: {
  code: string;
  pin: string;
}): { error: string } | { code: string } {
  if (input.pin !== TENANT_PIN) return { error: "PIN salah." };
  return normalizeRestaurantCode(input.code);
}

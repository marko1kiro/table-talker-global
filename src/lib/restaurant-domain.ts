const RESTAURANT_CODE_PATTERN = /^[A-Z0-9-]{6,32}$/;

export function validateRestaurantCode(value: string): { code: string } | { error: string } {
  return RESTAURANT_CODE_PATTERN.test(value) ? { code: value } : { error: "Kode Resto salah." };
}

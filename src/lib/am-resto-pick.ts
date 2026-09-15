const KEY = "lm.am.resto.v1";
type Scope = { id: string };

export function restoPickKey(menu: string) {
  return `${KEY}.${menu}`;
}

export function resolveRestoPick(stored: string | null, scope: Scope[]): string | null {
  if (stored && scope.some((r) => r.id === stored)) return stored;
  return scope[0]?.id ?? null;
}

export function saveRestoPick(menu: string, id: string) {
  try {
    localStorage.setItem(restoPickKey(menu), id);
  } catch {
    /* storage unavailable: selection stays in-memory */
  }
}

export function loadRestoPick(menu: string): string | null {
  try {
    return localStorage.getItem(restoPickKey(menu));
  } catch {
    return null;
  }
}

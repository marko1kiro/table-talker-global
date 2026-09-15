export function pastWibDates(endDate: string, n: number): string[] {
  const end = Date.parse(`${endDate}T12:00:00Z`);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(end - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

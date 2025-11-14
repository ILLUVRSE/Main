export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    const sortedEntries = Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]);
    return Object.fromEntries(sortedEntries);
  }
  return value;
}

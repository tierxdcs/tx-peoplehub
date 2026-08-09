import { apiFetch } from './api';

export type EmployeeNameRecord = {
  firstName: string;
  lastName: string;
};

export type EmployeeLookup = (id: string) => Promise<EmployeeNameRecord>;

export function unresolvedEmployeeLabel(id: string): string {
  return `Unknown employee (${id})`;
}

export function employeeNameOrFallback(
  names: Record<string, string>,
  id: string,
): string {
  return names[id] ?? unresolvedEmployeeLabel(id);
}

export async function resolveEmployeeNames(
  ids: string[],
  lookup: EmployeeLookup = (id) =>
    apiFetch<EmployeeNameRecord>(`/employees/${id}`),
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Array.from(new Set(ids)).map(async (id) => {
      try {
        const employee = await lookup(id);
        const name = `${employee.firstName} ${employee.lastName}`.trim();
        return [id, name || unresolvedEmployeeLabel(id)] as const;
      } catch {
        return [id, unresolvedEmployeeLabel(id)] as const;
      }
    }),
  );

  return Object.fromEntries(entries);
}

import { Role } from './jwt';

export type EmployeeStatus = 'ACTIVE' | 'INACTIVE';

export interface Employee {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: Role;
  verticalId: string | null;
  reportingManagerId: string | null;
  status: EmployeeStatus;
  deactivatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Vertical {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

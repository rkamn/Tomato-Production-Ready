import Employee, { IEmployee, EMPLOYEE_ROLES, EmployeeRole } from './Employee.js';

export const USER_ROLES = [
  'customer',
  'restaurant',
  'deliveryPartner',
  'admin',
  'subadmin',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type IUser = IEmployee & Record<string, any>;
export const User = Employee;
export default Employee;
export { Employee, IEmployee, EMPLOYEE_ROLES, EmployeeRole };

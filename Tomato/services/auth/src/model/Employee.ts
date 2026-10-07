import mongoose, { Document, Schema } from 'mongoose';

export const EMPLOYEE_ROLES = ['admin', 'subadmin'] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const USER_ROLES = [
  'customer',
  'restaurant',
  'deliveryPartner',
  'admin',
  'subadmin',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface IEmployee extends Document {
  name: string;
  email?: string;
  phone?: string;
  image: string;
  role: EmployeeRole;
  passwordHash: string;
  resetPasswordTokenHash?: string;
  resetPasswordExpiresAt?: Date;
  isApproved: boolean;
  isBlocked: boolean;
  adminRoleTitle: string;
  permissions: string[];
  subadminId?: string;
  adminId?: string;
  walletBalance?: number;
  creditPoint?: number;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const schema: Schema<IEmployee> = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    phone: { type: String, unique: true, sparse: true, trim: true },
    image: { type: String, default: '' },
    role: {
      type: String,
      enum: EMPLOYEE_ROLES,
      default: 'admin',
      required: true,
    },
    passwordHash: { type: String, required: true, select: false },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpiresAt: { type: Date, select: false },
    isApproved: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false },
    adminRoleTitle: { type: String, default: 'Platform Admin' },
    permissions: { type: [String], default: [] },
    subadminId: { type: String, unique: true, sparse: true, trim: true },
    adminId: { type: String, unique: true, sparse: true, trim: true },
    walletBalance: { type: Number, default: 0 },
    creditPoint: { type: Number, default: 0 },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true, collection: 'employees' },
);

const Employee = mongoose.model<IEmployee>('Employee', schema, 'employees');

export default Employee;


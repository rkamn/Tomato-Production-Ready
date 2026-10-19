import mongoose, { Document, Schema } from 'mongoose';
import { IBankDetails } from './Restaurant.js';

export const EMPLOYEE_ROLES = ['superadmin', 'admin', 'subadmin', 'employee'] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const USER_ROLES = [
  'customer',
  'restaurant',
  'shop',
  'deliveryPartner',
  'superadmin',
  'admin',
  'subadmin',
  'employee',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface IAssignedLocation {
  city: string;
  postalCode: string;
  state?: string;
  locality?: string;
  line1?: string;
  label?: string;
  digipin?: string;
  assignedBy?: string;
  assignedAt?: Date;
  location?: {
    type: string;
    coordinates: [number, number];
  };
}

export interface IEmployee extends Document {
  name: string;
  username?: string;
  email?: string;
  phone?: string;
  image: string;
  role: string;
  baseRole?: string;
  passwordHash: string;
  resetPasswordTokenHash?: string;
  resetPasswordExpiresAt?: Date;
  isApproved: boolean;
  isBlocked: boolean;
  adminRoleTitle: string;
  permissions: string[];
  subadminId?: string;
  adminId?: string;
  employeeId?: string;
  salary?: number;
  walletBalance?: number;
  creditPoint?: number;
  dob?: string;
  gsnNumber?: string;
  bankDetails?: IBankDetails;
  assignedLocation?: IAssignedLocation;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const schema: Schema<IEmployee> = new Schema(
  {
    name: { type: String, required: true, trim: true },
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
    },
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
      default: 'admin',
      required: true,
      trim: true,
    },
    baseRole: { type: String, default: 'admin', trim: true },
    passwordHash: { type: String, required: true, select: false },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpiresAt: { type: Date, select: false },
    isApproved: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false },
    adminRoleTitle: { type: String, default: 'Platform Admin' },
    permissions: { type: [String], default: [] },
    subadminId: { type: String, unique: true, sparse: true, trim: true },
    adminId: { type: String, unique: true, sparse: true, trim: true },
    employeeId: { type: String, unique: true, sparse: true, trim: true },
    salary: { type: Number, default: 0, min: 0 },
    walletBalance: { type: Number, default: 0, min: 0 },
    creditPoint: { type: Number, default: 0, min: 0 },
    dob: { type: String, default: '', trim: true },
    gsnNumber: { type: String, default: 'NA', uppercase: true, trim: true },
    bankDetails: {
      accountHolderName: { type: String, default: '', trim: true },
      bankName: { type: String, default: '', trim: true },
      accountNumber: { type: String, default: '', trim: true },
      ifscCode: { type: String, default: '', uppercase: true, trim: true },
      panNumber: { type: String, default: '', uppercase: true, trim: true },
      panHolderName: { type: String, default: '', trim: true },
      upiId: { type: String, default: '', trim: true },
      isSubmitted: { type: Boolean, default: false },
      isApproved: { type: Boolean, default: false },
      isLocked: { type: Boolean, default: false },
      agreementCommissionPercent: { type: Number, default: 0, min: 0, max: 100 },
      riderPayoutPerOrder: { type: Number, default: 0 },
      submittedAt: { type: Date },
      approvedAt: { type: Date },
      approvedBy: { type: String, default: '' },
      adminNote: { type: String, default: '' },
    },
    assignedLocation: {
      city: { type: String, default: 'Bengaluru', trim: true },
      postalCode: { type: String, default: '560001', trim: true },
      state: { type: String, default: 'Karnataka', trim: true },
      locality: { type: String, default: 'Central HQ', trim: true },
      line1: { type: String, default: 'Tomato Operations Headquarters', trim: true },
      label: { type: String, default: 'Operations HQ', trim: true },
      digipin: { type: String, default: '', trim: true },
      assignedBy: { type: String, default: '' },
      assignedAt: { type: Date },
      location: {
        type: { type: String, default: 'Point' },
        coordinates: { type: [Number], default: [77.5946, 12.9716] },
      },
    },
    createdBy: { type: String, default: '' },
  },
  { timestamps: true, collection: 'employees' },
);

const Employee = mongoose.model<IEmployee>('Employee', schema, 'employees');

export default Employee;


import mongoose, { Document, Schema } from 'mongoose';

export interface IRole extends Document {
  roleKey: string;
  displayName: string;
  description?: string;
  baseRole: 'superadmin' | 'admin' | 'subadmin' | 'employee';
  permissions: string[];
  isSystem: boolean;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const roleSchema: Schema<IRole> = new Schema(
  {
    roleKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    displayName: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    baseRole: {
      type: String,
      enum: ['superadmin', 'admin', 'subadmin', 'employee'],
      default: 'subadmin',
      required: true,
    },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false },
    createdBy: { type: String, default: 'Super Admin', trim: true },
  },
  { timestamps: true, collection: 'roles' },
);

export const DEFAULT_SYSTEM_ROLES = [
  {
    roleKey: 'superadmin',
    displayName: 'Super Administrator',
    description:
      'Supreme platform authority with unrestricted access across all modules, regional locations, and role governance.',
    baseRole: 'superadmin',
    permissions: ['*'],
    isSystem: true,
    createdBy: 'System Root',
  },
  {
    roleKey: 'admin',
    displayName: 'Platform Administrator',
    description:
      'Full administrative access to manage platform operations, regional deployments, staff, partners, and financials.',
    baseRole: 'admin',
    permissions: ['*'],
    isSystem: true,
    createdBy: 'System Root',
  },
  {
    roleKey: 'subadmin',
    displayName: 'Operations Sub-Admin',
    description:
      'Delegated administrative authority for managing orders, shops, restaurants, riders, and customer accounts.',
    baseRole: 'subadmin',
    permissions: [
      'dashboard_view',
      'orders_manage',
      'shops_manage',
      'restaurants_manage',
      'riders_manage',
      'customers_manage',
    ],
    isSystem: true,
    createdBy: 'System Root',
  },
  {
    roleKey: 'employee',
    displayName: 'Normal Employee',
    description:
      'Standard staff access for customer support, ticket resolution, and order status tracking.',
    baseRole: 'employee',
    permissions: ['orders_manage', 'support_manage'],
    isSystem: true,
    createdBy: 'System Root',
  },
];

/**
 * Ensures default built-in system roles exist in the database.
 */
export async function ensureDefaultRoles(): Promise<void> {
  try {
    for (const sysRole of DEFAULT_SYSTEM_ROLES) {
      await Role.findOneAndUpdate(
        { roleKey: sysRole.roleKey },
        {
          $setOnInsert: {
            roleKey: sysRole.roleKey,
            displayName: sysRole.displayName,
            description: sysRole.description,
            baseRole: sysRole.baseRole,
            permissions: sysRole.permissions,
            isSystem: true,
            createdBy: sysRole.createdBy,
          },
        },
        { upsert: true, new: true },
      );
    }
  } catch (err) {
    console.warn('[Role Seed] Notice ensuring default roles:', err);
  }
}

const Role = mongoose.model<IRole>('Role', roleSchema, 'roles');
export default Role;

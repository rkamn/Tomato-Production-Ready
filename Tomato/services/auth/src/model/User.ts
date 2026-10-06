import mongoose, { Document, Schema } from 'mongoose';

export const USER_ROLES = [
  'customer',
  'restaurant',
  'deliveryPartner',
  'admin',
  'subadmin',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface IUser extends Document {
  name: string;
  email?: string;
  phone?: string;
  image: string;
  role: UserRole;
  passwordHash: string;
  resetPasswordTokenHash?: string;
  resetPasswordExpiresAt?: Date;
  isApproved?: boolean;
  isBlocked?: boolean;
  walletBalance?: number;
  creditPoint?: number;
  adminRoleTitle?: string;
  permissions?: string[];
  createdBy?: string;
  restaurantId?: string;
  riderId?: string;
  customerId?: string;
  subadminId?: string;
  digipin?: string;
  restaurantAddress?: string;
  restaurantLocation?: {
    lat: number;
    lng: number;
  };
  cuisine?: string;
  deliveryVehicle?: string;
  currentLocation?: {
    lat: number;
    lng: number;
  };
  isOnline?: boolean;
  isOpen?: boolean;
  lastLocationUpdated?: Date;
}

const schema: Schema<IUser> = new Schema(
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
      enum: USER_ROLES,
      default: 'customer',
      required: true,
    },
    passwordHash: { type: String, required: true, select: false },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpiresAt: { type: Date, select: false },
    isApproved: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false },
    walletBalance: { type: Number, min: 0 },
    creditPoint: { type: Number, min: 0 },
    adminRoleTitle: { type: String, default: 'Sub-Admin' },
    permissions: { type: [String], default: [] },
    createdBy: { type: String, default: '' },
    restaurantId: { type: String, sparse: true, trim: true },
    riderId: { type: String, sparse: true, trim: true },
    customerId: { type: String, sparse: true, trim: true },
    subadminId: { type: String, sparse: true, trim: true },
    digipin: { type: String, default: '', trim: true },
    restaurantAddress: { type: String, default: '' },
    restaurantLocation: {
      lat: { type: Number, default: 12.9716 },
      lng: { type: Number, default: 77.5946 },
    },
    cuisine: { type: String, default: '' },
    deliveryVehicle: { type: String, default: 'motorcycle' },
    currentLocation: {
      lat: { type: Number, default: 12.9716 },
      lng: { type: Number, default: 77.5946 },
    },
    isOnline: { type: Boolean, default: true },
    isOpen: { type: Boolean, default: true },
    lastLocationUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const User = mongoose.model<IUser>('User', schema);

export default User;

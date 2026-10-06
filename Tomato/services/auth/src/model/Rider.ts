import mongoose, { Document, Schema } from 'mongoose';

export interface IRider extends Document {
  name: string;
  email?: string;
  phone?: string;
  image: string;
  role: 'deliveryPartner';
  passwordHash: string;
  resetPasswordTokenHash?: string;
  resetPasswordExpiresAt?: Date;
  isApproved: boolean;
  isBlocked: boolean;
  walletBalance: number;
  creditPoint: number;
  riderId: string;
  deliveryVehicle: string;
  currentLocation: {
    lat: number;
    lng: number;
  };
  isOnline: boolean;
  lastLocationUpdated?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const schema: Schema<IRider> = new Schema(
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
      default: 'deliveryPartner',
      immutable: true,
    },
    passwordHash: { type: String, required: true, select: false },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpiresAt: { type: Date, select: false },
    isApproved: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    walletBalance: { type: Number, default: 0, min: 0 },
    creditPoint: { type: Number, default: 0, min: 0 },
    riderId: { type: String, unique: true, sparse: true, trim: true },
    deliveryVehicle: { type: String, default: 'motorcycle' },
    currentLocation: {
      lat: { type: Number, default: 12.9716 },
      lng: { type: Number, default: 77.5946 },
    },
    isOnline: { type: Boolean, default: true },
    lastLocationUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'riders' },
);

const Rider = mongoose.model<IRider>('Rider', schema);

export default Rider;

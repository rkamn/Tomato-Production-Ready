import mongoose, { Document, Schema } from 'mongoose';

export interface ICustomer extends Document {
  name: string;
  email?: string;
  phone?: string;
  image: string;
  role: 'customer';
  passwordHash: string;
  resetPasswordTokenHash?: string;
  resetPasswordExpiresAt?: Date;
  isApproved: boolean;
  isBlocked: boolean;
  walletBalance: number;
  creditPoint: number;
  customerId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const schema: Schema<ICustomer> = new Schema(
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
      default: 'customer',
      immutable: true,
    },
    passwordHash: { type: String, required: true, select: false },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpiresAt: { type: Date, select: false },
    isApproved: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false },
    walletBalance: { type: Number, default: 0, min: 0 },
    creditPoint: { type: Number, default: 0, min: 0 },
    customerId: { type: String, unique: true, sparse: true, trim: true },
  },
  { timestamps: true, collection: 'customers' },
);

const Customer = mongoose.model<ICustomer>('Customer', schema);

export default Customer;

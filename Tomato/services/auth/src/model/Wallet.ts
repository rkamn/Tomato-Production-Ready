import mongoose, { Document, Schema } from 'mongoose';

export interface IWallet extends Document {
  userId: string;
  name: string;
  role: string;
  walletBalance: number;
  creditPoint: number;
  email?: string;
  phone?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const schema: Schema<IWallet> = new Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      default: '',
      trim: true,
    },
    role: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    creditPoint: {
      type: Number,
      default: 0,
      min: 0,
    },
    email: {
      type: String,
      default: '',
      trim: true,
    },
    phone: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'wallet',
  },
);

schema.index({ userId: 1 }, { unique: true });
schema.index({ role: 1 });

const Wallet = mongoose.model<IWallet>('Wallet', schema);

export default Wallet;

import mongoose, { Document, Schema } from 'mongoose';

export type WalletRecordType = 'transfer' | 'balance_snapshot';

export interface IWalletCreditTrack extends Document {
  recordType: WalletRecordType;
  senderUserId?: string;
  senderEmail?: string;
  senderMobile?: string;
  receiverUserId?: string;
  receiverEmail?: string;
  receiverMobile?: string;
  senderCurrentWalletBalance?: number;
  senderCurrentCreditBalance?: number;
  receiverCurrentWalletBalance?: number;
  receiverCurrentCreditBalance?: number;
  creditTransferred?: number;
  purpose?: string;
  orderNumber?: string;
  adminUserId?: string;
  adminEmail?: string;
  adminMobile?: string;
  wallet_balance?: number;
  credit_point?: number;
  walletBalance?: number;
  creditPoint?: number;
  snapshotAt?: Date;
  createdAt?: Date;
}

const schema: Schema<IWalletCreditTrack> = new Schema(
  {
    recordType: {
      type: String,
      enum: ['transfer', 'balance_snapshot'],
      default: 'transfer',
      required: true,
    },
    senderUserId: { type: String, index: true },
    senderEmail: { type: String, default: '', trim: true },
    senderMobile: { type: String, default: '', trim: true },
    receiverUserId: { type: String, index: true },
    receiverEmail: { type: String, default: '', trim: true },
    receiverMobile: { type: String, default: '', trim: true },
    senderCurrentWalletBalance: { type: Number, min: 0 },
    senderCurrentCreditBalance: { type: Number, min: 0 },
    receiverCurrentWalletBalance: { type: Number, min: 0 },
    receiverCurrentCreditBalance: { type: Number, min: 0 },
    creditTransferred: { type: Number, min: 0 },
    purpose: { type: String, trim: true, maxlength: 500 },
    orderNumber: { type: String, default: '', trim: true, maxlength: 100 },
    adminUserId: { type: String },
    adminEmail: { type: String, default: '', trim: true },
    adminMobile: { type: String, default: '', trim: true },
    wallet_balance: { type: Number, min: 0 },
    credit_point: { type: Number, min: 0 },
    walletBalance: { type: Number, min: 0 },
    creditPoint: { type: Number, min: 0 },
    snapshotAt: { type: Date },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: 'wallet',
  },
);

schema.index(
  { adminUserId: 1 },
  {
    name: 'admin_balance_snapshot_unique',
    unique: true,
    partialFilterExpression: { recordType: 'balance_snapshot' },
  },
);

const WalletCreditTrack = mongoose.model<IWalletCreditTrack>(
  'WalletCreditTrack',
  schema,
);

export default WalletCreditTrack;

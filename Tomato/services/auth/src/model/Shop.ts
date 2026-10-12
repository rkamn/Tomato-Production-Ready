import mongoose, { Document, Schema } from 'mongoose';

import { IBankDetails } from './Restaurant.js';

export interface IShop extends Document {
  name: string;
  email?: string;
  phone?: string;
  image: string;
  role: 'shop';
  passwordHash: string;
  resetPasswordTokenHash?: string;
  resetPasswordExpiresAt?: Date;
  isApproved: boolean;
  isBlocked: boolean;
  walletBalance: number;
  creditPoint: number;
  shopId: string;
  digipin: string;
  pincode?: string;
  shopAddress: string;
  shopLocation: {
    lat: number;
    lng: number;
  };
  category: string;
  isOnline: boolean;
  isOpen: boolean;
  bankDetails?: IBankDetails;
  dob?: string;
  lastLocationUpdated?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const shopSchema: Schema<IShop> = new Schema(
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
      default: 'shop',
      immutable: true,
    },
    passwordHash: { type: String, required: true, select: false },
    resetPasswordTokenHash: { type: String, select: false },
    resetPasswordExpiresAt: { type: Date, select: false },
    isApproved: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
    walletBalance: { type: Number, default: 0, min: 0 },
    creditPoint: { type: Number, default: 0, min: 0 },
    shopId: { type: String, unique: true, sparse: true, trim: true },
    digipin: { type: String, default: '', trim: true },
    pincode: { type: String, default: '', trim: true },
    dob: { type: String, default: '', trim: true },
    shopAddress: { type: String, default: '' },
    shopLocation: {
      lat: { type: Number, default: 12.9716 },
      lng: { type: Number, default: 77.5946 },
    },
    category: { type: String, default: 'Retail, Supermarket & Groceries' },
    isOnline: { type: Boolean, default: true },
    isOpen: { type: Boolean, default: true },
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
      agreementCommissionPercent: { type: Number, default: 12, min: 0, max: 100 },
      submittedAt: { type: Date },
      approvedAt: { type: Date },
      approvedBy: { type: String, default: '' },
      adminNote: { type: String, default: '' },
    },
    lastLocationUpdated: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'shop' },
);

// Cascade delete associated items when a shop is removed
shopSchema.pre(
  ['deleteOne', 'findOneAndDelete'],
  { document: false, query: true },
  async function () {
    const doc = await this.model.findOne(this.getQuery()).select('_id');
    if (doc?._id) {
      const MenuItemModel =
        mongoose.models.MenuItem || mongoose.model('MenuItem');
      await MenuItemModel.deleteMany({ restaurantId: doc._id });
    }
  },
);

shopSchema.pre(
  'deleteOne',
  { document: true, query: false },
  async function () {
    if (this._id) {
      const MenuItemModel =
        mongoose.models.MenuItem || mongoose.model('MenuItem');
      await MenuItemModel.deleteMany({ restaurantId: this._id });
    }
  },
);

const Shop = mongoose.model<IShop>('Shop', shopSchema, 'shop');

export default Shop;

import mongoose, { Document, Schema } from 'mongoose';

export interface IPayment extends Document {
  orderId?: mongoose.Types.ObjectId;
  orderNumber: string;
  billNumber?: string;
  orderType: 'restaurant' | 'shop';
  customerId?: string;
  customerName?: string;
  customerPhone?: string;

  // Tomato Central Account Receipt
  subtotal: number;
  tax: number;
  deliveryFee: number;
  totalAmount: number;
  amount?: number; // legacy compatibility
  currency: string;
  paymentMethod: string;
  transactionId: string;
  tomatoAccountStatus: 'received' | 'pending_cod';
  tomatoReceivedAt?: Date;
  codCollectedVia?: 'cash' | 'upi';
  codCollectedAt?: Date;

  // Partner (Shop / Restaurant) Settlement
  partnerId?: string;
  partnerCode?: string;
  partnerRole: 'restaurant' | 'shop' | 'subadmin' | 'employee' | 'admin';
  partnerName: string;
  agreementCommissionPercent: number;
  tomatoCommissionAmount: number;
  partnerPayoutAmount: number;
  couponDiscountAmount?: number;
  couponSponsorType?: string;
  tomatoCouponShare?: number;
  partnerCouponShare?: number;
  partnerPayoutStatus: 'pending_approval' | 'approved_paid';
  partnerPaidAt?: Date;
  partnerPayoutRef?: string;
  partnerBankSnapshot?: {
    accountHolderName?: string;
    bankName?: string;
    accountNumber?: string;
    ifscCode?: string;
    panNumber?: string;
  };

  // Rider Settlement
  riderId?: string;
  riderCode?: string;
  riderName?: string;
  riderPayoutAmount: number;
  riderPayoutStatus: 'unassigned' | 'pending_approval' | 'approved_paid';
  riderPaidAt?: Date;
  riderPayoutRef?: string;
  riderBankSnapshot?: {
    accountHolderName?: string;
    bankName?: string;
    accountNumber?: string;
    ifscCode?: string;
    panNumber?: string;
  };

  approvedByAdmin?: string;
  adminNotes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const paymentSchema: Schema<IPayment> = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, index: true },
    orderNumber: { type: String, required: true, index: true, trim: true },
    billNumber: { type: String, default: '', trim: true },
    orderType: {
      type: String,
      enum: ['restaurant', 'shop'],
      default: 'restaurant',
    },
    customerId: { type: String, default: '' },
    customerName: { type: String, default: 'Customer' },
    customerPhone: { type: String, default: '' },

    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 40 },
    totalAmount: { type: Number, required: true, default: 0 },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'INR' },
    paymentMethod: { type: String, default: 'razorpay' },
    transactionId: { type: String, default: '' },
    tomatoAccountStatus: {
      type: String,
      enum: ['received', 'pending_cod'],
      default: 'received',
    },
    tomatoReceivedAt: { type: Date, default: Date.now },
    codCollectedVia: { type: String, enum: ['cash', 'upi'] },
    codCollectedAt: { type: Date },

    partnerId: { type: String, default: '', index: true },
    partnerCode: { type: String, default: '' },
    partnerRole: {
      type: String,
      enum: ['restaurant', 'shop', 'subadmin', 'employee', 'admin'],
      default: 'restaurant',
    },
    partnerName: { type: String, default: '' },
    agreementCommissionPercent: { type: Number, default: 15 },
    tomatoCommissionAmount: { type: Number, default: 0 },
    partnerPayoutAmount: { type: Number, default: 0 },
    couponDiscountAmount: { type: Number, default: 0 },
    couponSponsorType: { type: String, default: '' },
    tomatoCouponShare: { type: Number, default: 0 },
    partnerCouponShare: { type: Number, default: 0 },
    partnerPayoutStatus: {
      type: String,
      enum: ['pending_approval', 'approved_paid'],
      default: 'pending_approval',
    },
    partnerPaidAt: { type: Date },
    partnerPayoutRef: { type: String, default: '' },
    partnerBankSnapshot: {
      accountHolderName: { type: String, default: '' },
      bankName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      ifscCode: { type: String, default: '' },
      panNumber: { type: String, default: '' },
    },

    riderId: { type: String, default: '', index: true },
    riderCode: { type: String, default: '' },
    riderName: { type: String, default: '' },
    riderPayoutAmount: { type: Number, default: 40 },
    riderPayoutStatus: {
      type: String,
      enum: ['unassigned', 'pending_approval', 'approved_paid'],
      default: 'unassigned',
    },
    riderPaidAt: { type: Date },
    riderPayoutRef: { type: String, default: '' },
    riderBankSnapshot: {
      accountHolderName: { type: String, default: '' },
      bankName: { type: String, default: '' },
      accountNumber: { type: String, default: '' },
      ifscCode: { type: String, default: '' },
      panNumber: { type: String, default: '' },
    },

    approvedByAdmin: { type: String, default: '' },
    adminNotes: { type: String, default: '' },
  },
  { timestamps: true, collection: 'payments' },
);

const Payment = mongoose.model<IPayment>('Payment', paymentSchema, 'payments');

export default Payment;

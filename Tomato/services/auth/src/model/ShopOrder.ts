import mongoose, { Document, Schema } from 'mongoose';
import {
  IOrderItem,
  IOrderAddress,
  OrderStatus,
  PaymentStatus,
  PaymentMethod,
  IOrderStatusHistory,
} from './Order.js';

export interface IShopOrder extends Document {
  orderNumber: string;
  billNumber: string;
  customerId?: mongoose.Types.ObjectId;
  customerName?: string;
  customerPhone?: string;
  shopId?: mongoose.Types.ObjectId;
  shopCode?: string;
  digipin?: string;
  shopName?: string;
  shopAddress?: string;
  shopLocation?: {
    lat: number;
    lng: number;
  };
  riderId?: mongoose.Types.ObjectId;
  riderCode?: string;
  riderName?: string;
  riderPhone?: string;
  items: IOrderItem[];
  subtotal: number;
  tax: number;
  deliveryFee: number;
  totalAmount: number;
  deliveryAddress?: IOrderAddress;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  paymentTransactionId?: string;
  paidAt?: Date;
  status: OrderStatus;
  statusHistory: IOrderStatusHistory[];
  rejectedByRiders?: mongoose.Types.ObjectId[];
  isArchived?: boolean;
  archivedAt?: Date | null;
  archivedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const shopOrderItemSchema: Schema<IOrderItem> = new Schema(
  {
    foodItemId: {
      type: Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: false,
    },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, default: 0 },
  },
  { _id: false },
);

const shopOrderAddressSchema: Schema<IOrderAddress> = new Schema(
  {
    label: { type: String, default: 'Home' },
    phone: { type: String, default: '' },
    line1: { type: String, default: '' },
    line2: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    postalCode: { type: String, default: '' },
    coordinates: { type: [Number], default: [77.5946, 12.9716] },
  },
  { _id: false },
);

const shopStatusHistorySchema: Schema<IOrderStatusHistory> = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { _id: false },
);

const shopOrderSchema: Schema<IShopOrder> = new Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
      required: true,
      trim: true,
      index: true,
    },
    billNumber: {
      type: String,
      trim: true,
      default: '',
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      index: true,
    },
    customerName: {
      type: String,
      default: '',
    },
    customerPhone: {
      type: String,
      default: '',
    },
    shopId: {
      type: Schema.Types.ObjectId,
      ref: 'Shop',
      index: true,
    },
    shopCode: {
      type: String,
      default: '',
      trim: true,
    },
    digipin: {
      type: String,
      default: '',
      trim: true,
    },
    shopName: {
      type: String,
      default: 'Tomato Partner Shop',
    },
    shopAddress: {
      type: String,
      default: '45 CMH Road, Indiranagar, Bengaluru, 560038',
    },
    shopLocation: {
      lat: { type: Number, default: 12.9784 },
      lng: { type: Number, default: 77.6408 },
    },
    riderId: {
      type: Schema.Types.ObjectId,
      ref: 'Rider',
      index: true,
    },
    riderCode: {
      type: String,
      default: '',
      trim: true,
    },
    riderName: {
      type: String,
      default: '',
    },
    riderPhone: {
      type: String,
      default: '',
    },
    items: {
      type: [shopOrderItemSchema],
      required: true,
      default: [],
    },
    subtotal: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    tax: {
      type: Number,
      default: 0,
    },
    deliveryFee: {
      type: Number,
      default: 40,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    deliveryAddress: {
      type: shopOrderAddressSchema,
      default: () => ({}),
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    paymentMethod: {
      type: String,
      enum: ['card', 'upi', 'netbanking', 'cod', 'gateway_mock'],
      default: 'cod',
    },
    paymentTransactionId: {
      type: String,
      default: '',
    },
    paidAt: {
      type: Date,
    },
    status: {
      type: String,
      enum: [
        'placed',
        'accepted',
        'preparing',
        'ready_for_pickup',
        'out_for_delivery',
        'delivered',
        'cancelled',
        'pending',
        'confirmed',
      ],
      default: 'placed',
      index: true,
    },
    statusHistory: {
      type: [shopStatusHistorySchema],
      default: [],
    },
    rejectedByRiders: {
      type: [Schema.Types.ObjectId],
      ref: 'Rider',
      default: [],
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    archivedAt: {
      type: Date,
    },
    archivedBy: {
      type: String,
      default: '',
    },
  },
  { timestamps: true, collection: 'shop_orders' },
);

shopOrderSchema.index({ customerId: 1, createdAt: -1 });
shopOrderSchema.index({ shopId: 1, status: 1, createdAt: -1 });
shopOrderSchema.index({ riderId: 1, status: 1, updatedAt: -1 });

const ShopOrder = mongoose.model<IShopOrder>('ShopOrder', shopOrderSchema, 'shop_orders');

export default ShopOrder;

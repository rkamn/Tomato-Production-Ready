import mongoose, { Document, Schema } from 'mongoose';

export interface IOrderItem {
  foodItemId: mongoose.Types.ObjectId;
  name: string;
  quantity: number;
  price: number;
  totalPrice?: number;
}

export interface IOrderAddress {
  label?: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  coordinates?: [number, number]; // [lng, lat]
}

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'pending'
  | 'confirmed';

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type PaymentMethod = 'card' | 'upi' | 'netbanking' | 'cod' | 'gateway_mock';

export interface IOrderStatusHistory {
  status: OrderStatus;
  at: Date;
  by?: string;
  note?: string;
}

export interface IOrder extends Document {
  orderNumber: string;
  billNumber: string;
  customerId: mongoose.Types.ObjectId;
  customerName?: string;
  customerPhone?: string;
  restaurantId?: mongoose.Types.ObjectId;
  restaurantCode?: string;
  digipin?: string;
  restaurantName?: string;
  restaurantAddress?: string;
  restaurantLocation?: {
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

const orderItemSchema: Schema<IOrderItem> = new Schema(
  {
    foodItemId: {
      type: Schema.Types.ObjectId,
      ref: 'FoodItem',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    totalPrice: { type: Number, default: 0 },
  },
  { _id: false },
);

const orderAddressSchema: Schema<IOrderAddress> = new Schema(
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

const statusHistorySchema: Schema<IOrderStatusHistory> = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, default: Date.now },
    by: { type: String, default: '' },
    note: { type: String, default: '' },
  },
  { _id: false },
);

const orderSchema: Schema<IOrder> = new Schema(
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
      ref: 'User',
      required: true,
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
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    restaurantCode: {
      type: String,
      default: '',
      trim: true,
    },
    digipin: {
      type: String,
      default: '',
      trim: true,
    },
    restaurantName: {
      type: String,
      default: 'Tomato Partner Restaurant',
    },
    restaurantAddress: {
      type: String,
      default: '12 Indiranagar 100ft Road, Bengaluru, 560038',
    },
    restaurantLocation: {
      lat: { type: Number, default: 12.9716 },
      lng: { type: Number, default: 77.5946 },
    },
    riderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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
      type: [orderItemSchema],
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
      type: orderAddressSchema,
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
      type: [statusHistorySchema],
      default: [],
    },
    rejectedByRiders: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
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
  { timestamps: true },
);

orderSchema.index({ customerId: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });
orderSchema.index({ riderId: 1, status: 1, updatedAt: -1 });

const Order = mongoose.model<IOrder>('Order', orderSchema);

export default Order;

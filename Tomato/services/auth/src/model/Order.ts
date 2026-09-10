import mongoose, { Document, Schema } from 'mongoose';

export interface IOrderItem {
  foodItemId: mongoose.Types.ObjectId;
  name: string;
  quantity: number;
  price: number;
}

export interface IOrder extends Document {
  customerId: mongoose.Types.ObjectId;
  restaurantId?: mongoose.Types.ObjectId;
  items: IOrderItem[];
  totalAmount: number;
  status: 'pending' | 'confirmed' | 'delivered';
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
  },
  { _id: false },
);

const orderSchema: Schema<IOrder> = new Schema(
  {
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
      default: [],
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'delivered'],
      default: 'pending',
    },
  },
  { timestamps: true },
);

const Order = mongoose.model<IOrder>('Order', orderSchema);

export default Order;

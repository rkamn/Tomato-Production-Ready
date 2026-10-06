import mongoose, { Schema } from 'mongoose';

export interface IOrderCounter {
  _id: string;
  lastNumber: number;
}

const orderCounterSchema: Schema<IOrderCounter> = new Schema(
  {
    _id: { type: String, required: true },
    lastNumber: { type: Number, required: true },
  },
  {
    versionKey: false,
    collection: 'order_counters',
  },
);

const OrderCounter = mongoose.model<IOrderCounter>(
  'OrderCounter',
  orderCounterSchema,
);

export default OrderCounter;

import mongoose, { Document, Schema } from 'mongoose';

export interface IReview extends Document {
  productId: mongoose.Types.ObjectId;
  productName: string;
  storeId?: mongoose.Types.ObjectId;
  storeName?: string;
  storeType?: 'restaurant' | 'shop';
  customerId: mongoose.Types.ObjectId;
  customerName: string;
  rating: number; // 1 to 5
  comment: string;
  orderId?: mongoose.Types.ObjectId;
  orderNumber?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema: Schema<IReview> = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: true,
      index: true,
    },
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    storeId: {
      type: Schema.Types.ObjectId,
      index: true,
    },
    storeName: {
      type: String,
      trim: true,
      default: '',
    },
    storeType: {
      type: String,
      enum: ['restaurant', 'shop'],
      default: 'restaurant',
    },
    customerId: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    customerName: {
      type: String,
      required: true,
      trim: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      default: '',
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
    },
    orderNumber: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true, collection: 'reviews' },
);

reviewSchema.index({ productId: 1, customerId: 1 }, { unique: true });

export const Review = mongoose.model<IReview>('Review', reviewSchema, 'reviews');
export default Review;


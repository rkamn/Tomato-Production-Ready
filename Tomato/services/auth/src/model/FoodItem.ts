import mongoose, { Document, Schema } from 'mongoose';

export interface IFoodItem extends Document {
  restaurantId: mongoose.Types.ObjectId;
  name: string;
  quantity: number;
  price: number;
  isActive: boolean;
}

const foodItemSchema: Schema<IFoodItem> = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

const FoodItem = mongoose.model<IFoodItem>('FoodItem', foodItemSchema);

export default FoodItem;

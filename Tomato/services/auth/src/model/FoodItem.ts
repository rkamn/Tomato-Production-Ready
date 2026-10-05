import mongoose, { Document, Schema } from 'mongoose';

export interface IFoodItem extends Document {
  restaurantId: mongoose.Types.ObjectId;
  restaurantName?: string;
  name: string;
  category: string;
  description: string;
  dietary: 'veg' | 'non-veg' | 'vegan';
  image: string;
  quantity: number;
  price: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const foodItemSchema: Schema<IFoodItem> = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    restaurantName: {
      type: String,
      trim: true,
      default: '',
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      trim: true,
      default: 'Main Course',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    dietary: {
      type: String,
      enum: ['veg', 'non-veg', 'vegan'],
      default: 'veg',
    },
    image: {
      type: String,
      default: '',
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 10,
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

foodItemSchema.index({ restaurantId: 1, isActive: 1 });
foodItemSchema.index({ name: 'text', category: 'text' });

const FoodItem = mongoose.model<IFoodItem>('FoodItem', foodItemSchema);

export default FoodItem;

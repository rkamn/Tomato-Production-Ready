import mongoose, { Document, Schema } from 'mongoose';

export interface IMenuItem extends Document {
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

export type IFoodItem = IMenuItem;

const menuItemSchema: Schema<IMenuItem> = new Schema(
  {
    restaurantId: {
      type: Schema.Types.ObjectId,
      ref: 'Restaurant',
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
  { timestamps: true, collection: 'menuitems' },
);

menuItemSchema.index({ restaurantId: 1, isActive: 1 });
menuItemSchema.index({ name: 'text', category: 'text' });

export const MenuItem = mongoose.model<IMenuItem>('MenuItem', menuItemSchema, 'menuitems');
export const FoodItem = MenuItem;

export default MenuItem;

import mongoose, { Document, Schema } from 'mongoose';

export interface IAddress extends Document {
  userId: string;
  label: string;
  phone?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  isDefault: boolean;
  location?: {
    type: 'Point';
    coordinates: [number, number];
  };
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema: Schema<IAddress> = new Schema(
  {
    userId: { type: String, required: true, index: true },
    label: { type: String, required: true, trim: true, default: 'Home' },
    phone: { type: String, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, trim: true, default: '' },
    city: { type: String, required: true, trim: true },
    state: { type: String, trim: true, default: '' },
    postalCode: { type: String, trim: true, default: '' },
    isDefault: { type: Boolean, default: false },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
  },
  { timestamps: true },
);

addressSchema.index({ userId: 1, isDefault: 1 });
addressSchema.index({ location: '2dsphere' });

const Address = mongoose.model<IAddress>('Address', addressSchema);

export default Address;

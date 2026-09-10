import mongoose, { Document, Schema } from 'mongoose';

export const NOTIFICATION_TYPES = ['order', 'menu', 'service', 'system'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface INotification extends Document {
  userId: string;
  role: 'customer' | 'restaurant' | 'deliveryPartner' | 'admin';
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  entityId?: string;
  createdAt: Date;
}

const schema: Schema<INotification> = new Schema(
  {
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ['customer', 'restaurant', 'deliveryPartner', 'admin'], required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    type: { type: String, enum: NOTIFICATION_TYPES, default: 'service' },
    isRead: { type: Boolean, default: false },
    entityId: { type: String, default: '' },
  },
  { timestamps: true },
);

const Notification = mongoose.model<INotification>('Notification', schema);

export default Notification;

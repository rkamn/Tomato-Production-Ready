import mongoose, { Document, Model, Schema } from 'mongoose';

export const NOTIFICATION_TYPES = ['order', 'menu', 'service', 'system'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const MAX_NOTIFICATIONS_PER_USER = 15;
export const NOTIFICATION_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (604,800 seconds)

export interface INotification extends Document {
  userId: string;
  role: 'customer' | 'restaurant' | 'shop' | 'deliveryPartner' | 'admin' | 'subadmin';
  title: string;
  message: string;
  type: NotificationType;
  isRead: boolean;
  entityId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface INotificationModel extends Model<INotification> {
  cleanExpiredAndExcess(userId?: string): Promise<{ deletedExpired: number; deletedExcess: number }>;
}

const schema: Schema<INotification, INotificationModel> = new Schema(
  {
    userId: { type: String, required: true, index: true },
    role: { type: String, enum: ['customer', 'restaurant', 'shop', 'deliveryPartner', 'admin', 'subadmin'], required: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    type: { type: String, enum: NOTIFICATION_TYPES, default: 'service' },
    isRead: { type: Boolean, default: false },
    entityId: { type: String, default: '' },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

// Compound index for querying user notifications
schema.index({ userId: 1, isRead: 1, createdAt: -1 });

// TTL Index: MongoDB automatically deletes notifications older than 7 days
schema.index({ createdAt: 1 }, { expireAfterSeconds: NOTIFICATION_TTL_SECONDS });

// Static helper to clean expired (> 7 days) and excess (> 15) notifications
schema.statics.cleanExpiredAndExcess = async function (userId?: string) {
  let deletedExpired = 0;
  let deletedExcess = 0;
  try {
    const sevenDaysAgo = new Date(Date.now() - NOTIFICATION_TTL_SECONDS * 1000);

    // 1. Delete notifications older than 7 days
    const expFilter = userId
      ? { userId: String(userId), createdAt: { $lt: sevenDaysAgo } }
      : { createdAt: { $lt: sevenDaysAgo } };
    const expRes = await this.deleteMany(expFilter);
    deletedExpired = expRes.deletedCount || 0;

    // 2. Enforce max 15 notifications per user
    if (userId) {
      const userNotifs = await this.find({ userId: String(userId) })
        .sort({ createdAt: -1 })
        .select('_id')
        .lean();

      if (userNotifs.length > MAX_NOTIFICATIONS_PER_USER) {
        const excessIds = userNotifs.slice(MAX_NOTIFICATIONS_PER_USER).map((n: any) => n._id);
        const excessRes = await this.deleteMany({ _id: { $in: excessIds } });
        deletedExcess = excessRes.deletedCount || 0;
      }
    }
  } catch (err) {
    console.error('Failed in cleanExpiredAndExcess:', err);
  }
  return { deletedExpired, deletedExcess };
};

// Automatic post-save hook: whenever a notification is created, enforce max 15 and 7-day limits
schema.post('save', async function (doc) {
  if (doc?.userId) {
    try {
      const Model = doc.constructor as any;
      if (typeof Model.cleanExpiredAndExcess === 'function') {
        await Model.cleanExpiredAndExcess(doc.userId);
      }
    } catch (err) {
      console.error('Auto notification cleanup post-save error:', err);
    }
  }
});

const Notification = mongoose.model<INotification, INotificationModel>('Notification', schema);

export default Notification;

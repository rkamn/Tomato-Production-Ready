import mongoose, { Document, Schema } from 'mongoose';

export type ComplaintStatus = 'Open' | 'In Review' | 'Resolved' | 'Closed';
export type ComplaintPriority = 'Normal' | 'High' | 'Urgent';

export interface IComplaint extends Document {
  ticketId: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone?: string;
  userRole: 'customer' | 'restaurant' | 'shop' | 'rider' | 'deliveryPartner' | 'admin' | 'subadmin';
  category: string;
  priority: ComplaintPriority;
  orderRef?: string;
  subject: string;
  description: string;
  status: ComplaintStatus;
  adminComment?: string;
  reviewedBy?: {
    userId?: string;
    name?: string;
    role?: string;
  };
  reviewedAt?: Date;
  closedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const complaintSchema: Schema<IComplaint> = new Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userName: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userEmail: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    userPhone: {
      type: String,
      trim: true,
      default: '',
    },
    userRole: {
      type: String,
      enum: ['customer', 'restaurant', 'shop', 'rider', 'deliveryPartner', 'admin', 'subadmin'],
      default: 'customer',
      index: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    priority: {
      type: String,
      enum: ['Normal', 'High', 'Urgent'],
      default: 'Normal',
    },
    orderRef: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['Open', 'In Review', 'Resolved', 'Closed'],
      default: 'Open',
      index: true,
    },
    adminComment: {
      type: String,
      trim: true,
      default: '',
    },
    reviewedBy: {
      userId: { type: String, default: '' },
      name: { type: String, default: '' },
      role: { type: String, default: '' },
    },
    reviewedAt: {
      type: Date,
    },
    closedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook: Automatically manage closedAt timestamp to govern the 1-week auto-deletion window
complaintSchema.pre('save', function () {
  if (this.status === 'Closed') {
    // If ticket is closed, refresh closedAt whenever status or comments change
    if (!this.closedAt || this.isModified('adminComment') || this.isModified('status') || this.isModified('description')) {
      this.closedAt = new Date();
    }
  } else {
    // If ticket is not closed (Open, In Review, Resolved), clear closedAt so it never expires
    this.closedAt = null;
  }
});

// Full-text search index for keyword queries
complaintSchema.index({ userName: 'text', userEmail: 'text', subject: 'text', description: 'text' });

// MongoDB TTL Index: automatically delete closed complaints after 1 week (7 days = 604,800 seconds) of inactivity
complaintSchema.index(
  { closedAt: 1 },
  {
    expireAfterSeconds: 7 * 24 * 60 * 60,
    partialFilterExpression: { status: 'Closed', closedAt: { $type: 'date' } },
  }
);

export const Complaint = mongoose.model<IComplaint>('Complaint', complaintSchema, 'complaints');

/**
 * Automatically purges closed complaint tickets that have had no updates for more than 7 days (1 week).
 * Returns the number of deleted documents.
 */
export async function cleanupExpiredClosedComplaints(): Promise<number> {
  try {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await Complaint.deleteMany({
      status: 'Closed',
      $or: [
        { closedAt: { $lte: oneWeekAgo } },
        {
          $and: [
            { $or: [{ closedAt: null }, { closedAt: { $exists: false } }] },
            { updatedAt: { $lte: oneWeekAgo } },
          ],
        },
      ],
    });

    if (result.deletedCount && result.deletedCount > 0) {
      console.log(
        `[Complaint Auto-Purge] Cleaned up ${result.deletedCount} closed ticket(s) inactive for > 1 week.`
      );
    }
    return result.deletedCount || 0;
  } catch (err) {
    console.error('[Complaint Auto-Purge Error] Failed to purge closed tickets:', err);
    return 0;
  }
}

export default Complaint;

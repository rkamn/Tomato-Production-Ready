import mongoose, { Document, Schema } from 'mongoose';

export interface ISession extends Document {
  sessionId: string;
  userId: mongoose.Types.ObjectId | string;
  role: string;
  email?: string;
  phone?: string;
  name?: string;
  ipAddress?: string;
  userAgent?: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  isValid: boolean;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  revokedReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema: Schema<ISession> = new Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    userId: {
      type: Schema.Types.Mixed,
      required: true,
      index: true,
    },
    role: {
      type: String,
      required: true,
      index: true,
    },
    email: { type: String, default: '', lowercase: true, trim: true },
    phone: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    deviceType: { type: String, default: 'desktop' },
    browser: { type: String, default: '' },
    os: { type: String, default: '' },
    isValid: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
    revokedAt: { type: Date },
    revokedReason: { type: String, default: '' },
  },
  {
    timestamps: true,
    collection: 'sessions',
  },
);

sessionSchema.index({ userId: 1, isValid: 1, expiresAt: 1 });

const Session = mongoose.model<ISession>('Session', sessionSchema, 'sessions');

export default Session;


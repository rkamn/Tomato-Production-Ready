import mongoose, { Schema } from 'mongoose';

export interface ICounter {
  _id: string; // Key name e.g. 'customerId', 'riderId', 'restaurentId', 'restaurantId', 'subadminId', 'adminId', 'orderId'
  seq: number;
  lastNumber: number;
  name?: string;
  counterType?: string;
  description?: string;
  customerId?: number;
  riderId?: number;
  restaurentId?: number;
  restaurantId?: number;
  subadminId?: number;
  adminId?: number;
  shopId?: number;
  orderId?: number;
  updatedAt?: Date;
  createdAt?: Date;
}

const counterSchema: Schema<ICounter> = new Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 1000 },
    lastNumber: { type: Number, required: true, default: 1000 },
    name: { type: String },
    counterType: { type: String },
    description: { type: String },
    customerId: { type: Number },
    riderId: { type: Number },
    restaurentId: { type: Number },
    restaurantId: { type: Number },
    subadminId: { type: Number },
    adminId: { type: Number },
    shopId: { type: Number },
    orderId: { type: Number },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'counters',
  },
);

// Synchronize seq and lastNumber
counterSchema.pre('save', function () {
  if (this.seq !== undefined && this.lastNumber === undefined) {
    this.lastNumber = this.seq;
  } else if (this.lastNumber !== undefined && this.seq === undefined) {
    this.seq = this.lastNumber;
  }
});

export const Counter = mongoose.model<ICounter>('Counter', counterSchema, 'counters');

/**
 * Atomically increments and returns the next sequence number for any counter type in `counters` table.
 * Supports:
 * - 'customerId'
 * - 'riderId'
 * - 'restaurentId' (and 'restaurantId')
 * - 'subadminId'
 * - 'adminId'
 * - 'orderId'
 * - Any custom or date-based counter name
 */
export const getNextCounterValue = async (
  counterKey: string,
  startValue: number = 1000,
): Promise<number> => {
  try {
    await Counter.updateOne(
      { _id: counterKey },
      {
        $setOnInsert: {
          seq: startValue,
          lastNumber: startValue,
          name: counterKey,
          counterType: counterKey,
        },
      },
      { upsert: true },
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
  }

  const counter = await Counter.findOneAndUpdate(
    { _id: counterKey },
    {
      $inc: { seq: 1, lastNumber: 1 },
      $set: { name: counterKey, counterType: counterKey },
    },
    { new: true, upsert: true },
  );

  const nextVal = counter?.seq ?? counter?.lastNumber ?? (startValue + 1);

  // Synchronize with 'all_counters' summary record in counters table
  const standardFields = ['customerId', 'riderId', 'restaurentId', 'restaurantId', 'shopId', 'subadminId', 'adminId', 'orderId'];
  const baseKey = counterKey.startsWith('orderId') ? 'orderId' : counterKey;
  if (standardFields.includes(baseKey)) {
    try {
      await Counter.updateOne(
        { _id: 'all_counters' },
        {
          $set: {
            [baseKey]: nextVal,
            ...(baseKey === 'restaurantId' ? { restaurentId: nextVal } : {}),
            ...(baseKey === 'restaurentId' ? { restaurantId: nextVal } : {}),
          },
        },
        { upsert: true },
      );
    } catch {
      // Non-blocking sync
    }
  }

  return nextVal;
};

/**
 * Universal ID generator for any counter type with collision prevention.
 */
export const generateIdFromCounter = async (
  counterKey: string,
  prefix: string,
  startValue: number = 1000,
  isTaken?: (id: string) => Promise<boolean>,
): Promise<string> => {
  while (true) {
    const nextVal = await getNextCounterValue(counterKey, startValue);
    const id = `${prefix}-${nextVal}`;
    if (!isTaken || !(await isTaken(id))) {
      return id;
    }
  }
};

export default Counter;

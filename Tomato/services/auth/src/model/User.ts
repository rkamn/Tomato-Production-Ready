import mongoose, { Document, Schema } from 'mongoose';

export const USER_ROLES = ['customer', 'restaurant', 'deliveryPartner', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export interface IUser extends Document {
    name: string;
    email?: string;
    phone?: string;
    image: string;
    role: UserRole;
    passwordHash: string;
}

const schema: Schema<IUser> = new Schema(
    {
        name: { type: String, required: true, trim: true },
        email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
        phone: { type: String, unique: true, sparse: true, trim: true },
        image: { type: String, default: '' },
        role: { type: String, enum: USER_ROLES, default: 'customer', required: true },
        passwordHash: { type: String, required: true, select: false },
    },
    { timestamps: true },
);

const User = mongoose.model<IUser>('User', schema);

export default User;
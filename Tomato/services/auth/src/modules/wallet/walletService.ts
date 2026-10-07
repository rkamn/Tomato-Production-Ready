import mongoose from 'mongoose';
import Customer, { ICustomer } from '../../model/Customer.js';
import Restaurant, { IRestaurant } from '../../model/Restaurant.js';
import Rider, { IRider } from '../../model/Rider.js';
import Employee, { IEmployee } from '../../model/Employee.js';
import WalletCreditTrack from '../../model/WalletCreditTrack.js';

export class WalletServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'WalletServiceError';
  }
}

const getAdminWalletSnapshot = async (adminId: string) => {
  const snapshot = await WalletCreditTrack.findOne({
    recordType: 'balance_snapshot',
    adminUserId: adminId,
  }).sort({ snapshotAt: -1, createdAt: -1 });
  if (!snapshot) {
    throw new WalletServiceError('Admin wallet snapshot was not found', 404);
  }
  return snapshot;
};

type Recipient =
  | { model: 'customer'; record: ICustomer }
  | { model: 'restaurant'; record: IRestaurant }
  | { model: 'rider'; record: IRider };

const RECIPIENT_PROJECTION =
  '_id name role email phone walletBalance creditPoint';

const adjustRecipientCredit = (
  recipient: Recipient,
  amount: number,
  projection = RECIPIENT_PROJECTION,
): Promise<ICustomer | IRestaurant | IRider | null> => {
  const update = { $inc: { creditPoint: amount } };
  const options = { returnDocument: 'after' as const };

  switch (recipient.model) {
    case 'customer':
      return Customer.findByIdAndUpdate(
        recipient.record._id,
        update,
        options,
      ).select(projection);
    case 'restaurant':
      return Restaurant.findByIdAndUpdate(
        recipient.record._id,
        update,
        options,
      ).select(projection);
    case 'rider':
      return Rider.findByIdAndUpdate(
        recipient.record._id,
        update,
        options,
      ).select(projection);
  }
};

export interface CreditPointTransferResult {
  adminCreditPoint: number;
  recipient: {
    id: string;
    name: string;
    role: string;
    creditPoint: number;
  };
}

export const getWalletBalances = async (
  userId: string,
  role: string,
): Promise<{ walletBalance: number; creditPoint: number }> => {
  if (!mongoose.isValidObjectId(userId)) {
    throw new WalletServiceError('Valid user ID is required', 401);
  }

  let account:
    | ICustomer
    | IRestaurant
    | IRider
    | IEmployee
    | null = null;

  if (role === 'admin' || role === 'subadmin') {
    const snapshot = await WalletCreditTrack.findOne({
      recordType: 'balance_snapshot',
      adminUserId: userId,
    }).sort({ snapshotAt: -1, createdAt: -1 });
    if (snapshot) {
      return {
        walletBalance: Number(snapshot.wallet_balance ?? 0),
        creditPoint: Number(snapshot.credit_point ?? 0),
      };
    }
    account = await Employee.findById(userId).select('walletBalance creditPoint');
  } else if (role === 'customer') {
    account = await Customer.findById(userId).select('walletBalance creditPoint');
  } else if (role === 'restaurant') {
    account = await Restaurant.findById(userId).select('walletBalance creditPoint');
  } else if (role === 'deliveryPartner' || role === 'rider') {
    account = await Rider.findById(userId).select('walletBalance creditPoint');
  }

  if (!account) {
    account = await Employee.findById(userId).select('walletBalance creditPoint');
  }
  if (!account) {
    throw new WalletServiceError('User wallet was not found', 404);
  }

  return {
    walletBalance: Number(account.walletBalance ?? 0),
    creditPoint: Number(account.creditPoint ?? 0),
  };
};

export const transferCreditPoints = async (
  adminId: string,
  recipientId: string,
  creditPoints: unknown,
  purposeValue: unknown,
  orderNumberValue: unknown,
): Promise<CreditPointTransferResult> => {
  if (!mongoose.isValidObjectId(adminId)) {
    throw new WalletServiceError('Valid admin ID is required', 401);
  }
  const lookupId = recipientId.trim();
  if (!lookupId || lookupId.length > 128) {
    throw new WalletServiceError('Recipient user ID is required', 400);
  }
  if (
    typeof creditPoints !== 'number' ||
    !Number.isSafeInteger(creditPoints) ||
    creditPoints <= 0
  ) {
    throw new WalletServiceError(
      'Credit points must be a positive whole number',
      400,
    );
  }
  const purpose = typeof purposeValue === 'string' ? purposeValue.trim() : '';
  const orderNumber =
    typeof orderNumberValue === 'string' ? orderNumberValue.trim() : '';
  if (!purpose || purpose.length > 500) {
    throw new WalletServiceError(
      'Transfer purpose is required and must be 500 characters or fewer',
      400,
    );
  }
  if (orderNumber.length > 100) {
    throw new WalletServiceError(
      'Order number must be 100 characters or fewer',
      400,
    );
  }

  const byAccountId = (accountField: string) => ({
    $or: [
      ...(mongoose.isValidObjectId(lookupId)
        ? [{ _id: new mongoose.Types.ObjectId(lookupId) }]
        : []),
      { [accountField]: lookupId },
    ],
  });
  const [customer, restaurant, rider, currentAdmin] = await Promise.all([
    Customer.findOne(byAccountId('customerId')).select(RECIPIENT_PROJECTION),
    Restaurant.findOne(byAccountId('restaurantId')).select(RECIPIENT_PROJECTION),
    Rider.findOne(byAccountId('riderId')).select(RECIPIENT_PROJECTION),
    Employee.findOne({ _id: adminId, role: 'admin' }).select(
      'name role email phone',
    ),
  ]);

  const recipients: Recipient[] = [
    ...(customer ? [{ model: 'customer' as const, record: customer }] : []),
    ...(restaurant
      ? [{ model: 'restaurant' as const, record: restaurant }]
      : []),
    ...(rider ? [{ model: 'rider' as const, record: rider }] : []),
  ];

  if (recipients.length === 0) {
    throw new WalletServiceError('Recipient user was not found', 404);
  }
  if (recipients.length > 1) {
    throw new WalletServiceError(
      'Recipient ID matches multiple accounts; transfer cancelled',
      409,
    );
  }

  const recipient = recipients[0];
  if (
    !recipient ||
    !['customer', 'restaurant', 'deliveryPartner'].includes(
      recipient.record.role,
    )
  ) {
    throw new WalletServiceError(
      'Credits can only be transferred to customer, rider, or restaurant wallets',
      400,
    );
  }
  if (!currentAdmin) {
    throw new WalletServiceError('Admin wallet was not found', 404);
  }

  const currentSnapshot = await getAdminWalletSnapshot(adminId);
  const updatedSnapshot = await WalletCreditTrack.findOneAndUpdate(
    {
      _id: currentSnapshot._id,
      recordType: 'balance_snapshot',
      credit_point: { $gte: creditPoints },
    },
    {
      $inc: { credit_point: -creditPoints },
      $set: { snapshotAt: new Date() },
    },
    { returnDocument: 'after' },
  );
  if (!updatedSnapshot) {
    throw new WalletServiceError(
      'Insufficient credit points in the admin wallet',
      409,
    );
  }

  let updatedRecipient: ICustomer | IRestaurant | IRider | null = null;
  try {
    updatedRecipient = await adjustRecipientCredit(recipient, creditPoints);

    if (!updatedRecipient) {
      throw new WalletServiceError(
        'Recipient wallet could not be updated; transfer cancelled',
        409,
      );
    }

    await WalletCreditTrack.create({
      recordType: 'transfer',
      senderUserId: adminId,
      senderEmail: currentAdmin.email ?? '',
      senderMobile: currentAdmin.phone ?? '',
      receiverUserId: String(updatedRecipient._id),
      receiverEmail: updatedRecipient.email ?? '',
      receiverMobile: updatedRecipient.phone ?? '',
      senderCurrentWalletBalance: Number(updatedSnapshot.wallet_balance ?? 0),
      senderCurrentCreditBalance: Number(updatedSnapshot.credit_point ?? 0),
      receiverCurrentWalletBalance: Number(
        updatedRecipient.walletBalance ?? 0,
      ),
      receiverCurrentCreditBalance: Number(
        updatedRecipient.creditPoint ?? 0,
      ),
      creditTransferred: creditPoints,
      purpose,
      orderNumber,
    });
  } catch (transferError) {
    if (updatedRecipient) {
      try {
        const rollback = await adjustRecipientCredit(
          recipient,
          -creditPoints,
          '_id',
        );
        if (!rollback) {
          throw new Error('Recipient record was not found during rollback');
        }
      } catch (rollbackError) {
        console.error('Recipient credit rollback failed:', {
          transferError,
          rollbackError,
        });
        throw new WalletServiceError(
          'Transfer failed; recipient rollback failed and the admin debit remains. Contact support',
          500,
        );
      }
    }

    try {
      await WalletCreditTrack.updateOne(
        { _id: updatedSnapshot._id, recordType: 'balance_snapshot' },
        {
          $inc: { credit_point: creditPoints },
          $set: { snapshotAt: new Date() },
        },
      );
    } catch (rollbackError) {
      console.error('Admin credit rollback failed:', {
        transferError,
        rollbackError,
      });
      throw new WalletServiceError(
        'Transfer failed and the admin balance rollback failed. Contact support',
        500,
      );
    }
    throw transferError;
  }

  return {
    adminCreditPoint: Number(updatedSnapshot.credit_point ?? 0),
    recipient: {
      id: String(updatedRecipient._id),
      name: updatedRecipient.name,
      role: updatedRecipient.role,
      creditPoint: Number(updatedRecipient.creditPoint ?? 0),
    },
  };
};
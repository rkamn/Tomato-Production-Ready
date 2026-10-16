import mongoose from 'mongoose';
import Customer, { ICustomer } from '../../model/Customer.js';
import Restaurant, { IRestaurant } from '../../model/Restaurant.js';
import Shop, { IShop } from '../../model/Shop.js';
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
  | { model: 'shop'; record: IShop }
  | { model: 'rider'; record: IRider }
  | { model: 'employee'; record: IEmployee };

const RECIPIENT_PROJECTION =
  '_id name role email phone walletBalance creditPoint customerId restaurantId shopId riderId subadminId adminId';

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const findRecipientAccount = async (
  rawLookupId: string,
): Promise<Recipient | null> => {
  const lookup = rawLookupId.trim();
  if (!lookup) return null;

  const escaped = escapeRegex(lookup);

  // 1. Direct MongoDB ObjectId match
  if (mongoose.isValidObjectId(lookup)) {
    const objId = new mongoose.Types.ObjectId(lookup);
    const [c, r, s, rd, emp] = await Promise.all([
      Customer.findById(objId).select(RECIPIENT_PROJECTION),
      Restaurant.findById(objId).select(RECIPIENT_PROJECTION),
      Shop.findById(objId).select(RECIPIENT_PROJECTION),
      Rider.findById(objId).select(RECIPIENT_PROJECTION),
      Employee.findById(objId).select(RECIPIENT_PROJECTION),
    ]);
    if (c) return { model: 'customer', record: c };
    if (r) return { model: 'restaurant', record: r };
    if (s) return { model: 'shop', record: s };
    if (rd) return { model: 'rider', record: rd };
    if (emp) return { model: 'employee', record: emp };
  }

  // Parse prefix and code if present (e.g. "cust-1001", "CUST 1001", "cust1001", "1001")
  const parsed = lookup.match(/^([a-zA-Z]+)?[-_ ]*0*([0-9a-zA-Z]+)$/);
  const prefix = (parsed?.[1] || '').toLowerCase();
  const code = (parsed?.[2] || lookup).trim();
  const escapedCode = escapeRegex(code);

  // 2. Account code exact / flexible regex queries
  const buildIdQuery = (rolePrefix: string, fieldName: string) => {
    const conditions: any[] = [
      { [fieldName]: { $regex: `^${escaped}$`, $options: 'i' } },
      { [fieldName]: { $regex: `^${rolePrefix}[-_ ]*0*${escapedCode}$`, $options: 'i' } },
      { [fieldName]: { $regex: `^${escapedCode}$`, $options: 'i' } },
    ];
    return { $or: conditions };
  };

  // Check target collection directly if prefix is recognized
  if (prefix === 'cust') {
    const cust = await Customer.findOne(buildIdQuery('cust', 'customerId')).select(RECIPIENT_PROJECTION);
    if (cust) return { model: 'customer', record: cust };
  } else if (prefix === 'rest') {
    const rest = await Restaurant.findOne(buildIdQuery('rest', 'restaurantId')).select(RECIPIENT_PROJECTION);
    if (rest) return { model: 'restaurant', record: rest };
  } else if (prefix === 'shop') {
    const shop = await Shop.findOne(buildIdQuery('shop', 'shopId')).select(RECIPIENT_PROJECTION);
    if (shop) return { model: 'shop', record: shop };
  } else if (prefix === 'ride') {
    const rider = await Rider.findOne(buildIdQuery('ride', 'riderId')).select(RECIPIENT_PROJECTION);
    if (rider) return { model: 'rider', record: rider };
  } else if (prefix === 'sub') {
    const emp = await Employee.findOne({
      $or: [
        { subadminId: { $regex: `^${escaped}$`, $options: 'i' } },
        { subadminId: { $regex: `^sub[-_ ]*0*${escapedCode}$`, $options: 'i' } },
      ],
    }).select(RECIPIENT_PROJECTION);
    if (emp) return { model: 'employee', record: emp };
  } else if (prefix === 'adm') {
    const emp = await Employee.findOne({
      $or: [
        { adminId: { $regex: `^${escaped}$`, $options: 'i' } },
        { adminId: { $regex: `^adm[-_ ]*0*${escapedCode}$`, $options: 'i' } },
      ],
    }).select(RECIPIENT_PROJECTION);
    if (emp) return { model: 'employee', record: emp };
  }

  // Cross-collection account ID search
  const [cById, rById, sById, rdById, empById] = await Promise.all([
    Customer.findOne(buildIdQuery('cust', 'customerId')).select(RECIPIENT_PROJECTION),
    Restaurant.findOne(buildIdQuery('rest', 'restaurantId')).select(RECIPIENT_PROJECTION),
    Shop.findOne(buildIdQuery('shop', 'shopId')).select(RECIPIENT_PROJECTION),
    Rider.findOne(buildIdQuery('ride', 'riderId')).select(RECIPIENT_PROJECTION),
    Employee.findOne({
      $or: [
        { subadminId: { $regex: `^${escaped}$`, $options: 'i' } },
        { adminId: { $regex: `^${escaped}$`, $options: 'i' } },
      ],
    }).select(RECIPIENT_PROJECTION),
  ]);

  const idMatches: Recipient[] = [
    ...(cById ? [{ model: 'customer' as const, record: cById }] : []),
    ...(rById ? [{ model: 'restaurant' as const, record: rById }] : []),
    ...(sById ? [{ model: 'shop' as const, record: sById }] : []),
    ...(rdById ? [{ model: 'rider' as const, record: rdById }] : []),
    ...(empById ? [{ model: 'employee' as const, record: empById }] : []),
  ];
  if (idMatches.length === 1 && idMatches[0]) return idMatches[0];
  if (idMatches.length > 1) {
    if (prefix) {
      const match = idMatches.find((m) =>
        (prefix === 'cust' && m.model === 'customer') ||
        (prefix === 'rest' && m.model === 'restaurant') ||
        (prefix === 'shop' && m.model === 'shop') ||
        (prefix === 'ride' && m.model === 'rider') ||
        (prefix === 'sub' && m.model === 'employee'),
      );
      if (match) return match;
    }
    throw new WalletServiceError(
      'Recipient ID matches multiple accounts; transfer cancelled',
      409,
    );
  }

  // 3. Email and Phone search
  const isEmail = lookup.includes('@');
  const isPhone = /^[+\d\s\-]{7,18}$/.test(lookup);
  if (isEmail || isPhone) {
    const contactOr: any[] = [];
    if (isEmail) {
      contactOr.push({ email: { $regex: `^${escaped}$`, $options: 'i' } });
    }
    if (isPhone) {
      const digits = lookup.replace(/\D/g, '');
      contactOr.push({ phone: lookup });
      if (digits.length >= 10) {
        contactOr.push({ phone: { $regex: `${digits.slice(-10)}$` } });
      }
    }
    const [cByContact, rByContact, sByContact, rdByContact, empByContact] = await Promise.all([
      Customer.findOne({ $or: contactOr }).select(RECIPIENT_PROJECTION),
      Restaurant.findOne({ $or: contactOr }).select(RECIPIENT_PROJECTION),
      Shop.findOne({ $or: contactOr }).select(RECIPIENT_PROJECTION),
      Rider.findOne({ $or: contactOr }).select(RECIPIENT_PROJECTION),
      Employee.findOne({ $or: contactOr }).select(RECIPIENT_PROJECTION),
    ]);
    const contactMatches: Recipient[] = [
      ...(cByContact ? [{ model: 'customer' as const, record: cByContact }] : []),
      ...(rByContact ? [{ model: 'restaurant' as const, record: rByContact }] : []),
      ...(sByContact ? [{ model: 'shop' as const, record: sByContact }] : []),
      ...(rdByContact ? [{ model: 'rider' as const, record: rdByContact }] : []),
      ...(empByContact ? [{ model: 'employee' as const, record: empByContact }] : []),
    ];
    if (contactMatches.length === 1 && contactMatches[0]) return contactMatches[0];
    if (contactMatches.length > 1) {
      throw new WalletServiceError(
        'Recipient contact matches multiple accounts; transfer cancelled',
        409,
      );
    }
  }

  // 4. Synthetic ID fallback (matching end of _id)
  // When a user has no explicit customerId/riderId/restaurantId/shopId,
  // the frontend generates synthetic IDs like "cust-" + _id.slice(-4)
  if (code && /^[0-9a-fA-F]{4,24}$/.test(code)) {
    const exprMatch = {
      $expr: {
        $regexMatch: {
          input: { $toString: '$_id' },
          regex: `${escapedCode}$`,
          options: 'i',
        },
      },
    };

    if (prefix === 'cust') {
      const c = await Customer.findOne(exprMatch).select(RECIPIENT_PROJECTION);
      if (c) {
        if (!c.customerId) {
          await Customer.updateOne({ _id: c._id }, { $set: { customerId: `cust-${code.toLowerCase()}` } }).catch(() => {});
        }
        return { model: 'customer', record: c };
      }
    } else if (prefix === 'rest') {
      const r = await Restaurant.findOne(exprMatch).select(RECIPIENT_PROJECTION);
      if (r) {
        if (!r.restaurantId) {
          await Restaurant.updateOne({ _id: r._id }, { $set: { restaurantId: `rest-${code.toLowerCase()}` } }).catch(() => {});
        }
        return { model: 'restaurant', record: r };
      }
    } else if (prefix === 'shop') {
      const s = await Shop.findOne(exprMatch).select(RECIPIENT_PROJECTION);
      if (s) {
        if (!s.shopId) {
          await Shop.updateOne({ _id: s._id }, { $set: { shopId: `shop-${code.toLowerCase()}` } }).catch(() => {});
        }
        return { model: 'shop', record: s };
      }
    } else if (prefix === 'ride') {
      const rd = await Rider.findOne(exprMatch).select(RECIPIENT_PROJECTION);
      if (rd) {
        if (!rd.riderId) {
          await Rider.updateOne({ _id: rd._id }, { $set: { riderId: `ride-${code.toLowerCase()}` } }).catch(() => {});
        }
        return { model: 'rider', record: rd };
      }
    } else if (prefix === 'sub') {
      const emp = await Employee.findOne(exprMatch).select(RECIPIENT_PROJECTION);
      if (emp) return { model: 'employee', record: emp };
    }

    const [cByExpr, rByExpr, sByExpr, rdByExpr, empByExpr] = await Promise.all([
      Customer.findOne(exprMatch).select(RECIPIENT_PROJECTION),
      Restaurant.findOne(exprMatch).select(RECIPIENT_PROJECTION),
      Shop.findOne(exprMatch).select(RECIPIENT_PROJECTION),
      Rider.findOne(exprMatch).select(RECIPIENT_PROJECTION),
      Employee.findOne(exprMatch).select(RECIPIENT_PROJECTION),
    ]);
    const exprMatches: Recipient[] = [
      ...(cByExpr ? [{ model: 'customer' as const, record: cByExpr }] : []),
      ...(rByExpr ? [{ model: 'restaurant' as const, record: rByExpr }] : []),
      ...(sByExpr ? [{ model: 'shop' as const, record: sByExpr }] : []),
      ...(rdByExpr ? [{ model: 'rider' as const, record: rdByExpr }] : []),
      ...(empByExpr ? [{ model: 'employee' as const, record: empByExpr }] : []),
    ];
    if (exprMatches.length === 1 && exprMatches[0]) return exprMatches[0];
    if (exprMatches.length > 1) {
      throw new WalletServiceError(
        'Recipient ID matches multiple accounts; transfer cancelled',
        409,
      );
    }
  }

  return null;
};

const adjustRecipientCredit = (
  recipient: Recipient,
  amount: number,
  projection = RECIPIENT_PROJECTION,
): Promise<ICustomer | IRestaurant | IShop | IRider | IEmployee | null> => {
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
    case 'shop':
      return Shop.findByIdAndUpdate(
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
    case 'employee':
      return Employee.findByIdAndUpdate(
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
        walletBalance: Math.max(0, Number(snapshot.wallet_balance ?? snapshot.walletBalance ?? 0)),
        creditPoint: Math.max(0, Number(snapshot.credit_point ?? snapshot.creditPoint ?? 0)),
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
    walletBalance: Math.max(0, Number(account.walletBalance ?? 0)),
    creditPoint: Math.max(0, Number(account.creditPoint ?? 0)),
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

  const [recipient, currentAdmin] = await Promise.all([
    findRecipientAccount(lookupId),
    Employee.findOne({ _id: adminId, role: 'admin' }).select(
      'name role email phone',
    ),
  ]);

  if (!recipient) {
    throw new WalletServiceError('Recipient user was not found', 404);
  }

  if (
    !['customer', 'restaurant', 'shop', 'deliveryPartner', 'rider', 'subadmin'].includes(
      recipient.record.role,
    )
  ) {
    throw new WalletServiceError(
      'Credits can only be transferred to customer, rider, shop, restaurant, or sub-admin wallets',
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

  let updatedRecipient: ICustomer | IRestaurant | IShop | IRider | IEmployee | null = null;
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
    adminCreditPoint: Math.max(0, Number(updatedSnapshot.credit_point ?? 0)),
    recipient: {
      id: String(updatedRecipient._id),
      name: updatedRecipient.name,
      role: updatedRecipient.role,
      creditPoint: Math.max(0, Number(updatedRecipient.creditPoint ?? 0)),
    },
  };
};
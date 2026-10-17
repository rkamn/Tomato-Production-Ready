import mongoose from 'mongoose';
import Customer, { ICustomer } from '../../model/Customer.js';
import Restaurant, { IRestaurant } from '../../model/Restaurant.js';
import Shop, { IShop } from '../../model/Shop.js';
import Rider, { IRider } from '../../model/Rider.js';
import Employee, { IEmployee } from '../../model/Employee.js';
import WalletCreditTrack from '../../model/WalletCreditTrack.js';
import Wallet, { IWallet } from '../../model/Wallet.js';

export class WalletServiceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'WalletServiceError';
  }
}

export const getOrCreateUserWallet = async (
  userId: string,
  role?: string,
  defaultName?: string,
): Promise<IWallet> => {
  let walletDoc = await Wallet.findOne({ userId });
  if (walletDoc) {
    return walletDoc;
  }

  let userRecord: any = null;
  const userRole = role || 'customer';

  if (userRole === 'admin' || userRole === 'subadmin') {
    userRecord = await Employee.findById(userId).select('name role email phone walletBalance creditPoint');
  } else if (userRole === 'customer') {
    userRecord = await Customer.findById(userId).select('name role email phone walletBalance creditPoint');
  } else if (userRole === 'restaurant') {
    userRecord = await Restaurant.findById(userId).select('name role email phone walletBalance creditPoint');
  } else if (userRole === 'shop') {
    userRecord = await Shop.findById(userId).select('name role email phone walletBalance creditPoint');
  } else if (userRole === 'deliveryPartner' || userRole === 'rider') {
    userRecord = await Rider.findById(userId).select('name role email phone walletBalance creditPoint');
  }

  if (!userRecord && mongoose.isValidObjectId(userId)) {
    userRecord = (await Employee.findById(userId)) ||
                 (await Customer.findById(userId)) ||
                 (await Restaurant.findById(userId)) ||
                 (await Shop.findById(userId)) ||
                 (await Rider.findById(userId));
  }

  const effectiveRole = userRecord?.role || userRole || 'customer';
  const name = (userRecord?.name || defaultName || (effectiveRole === 'admin' ? 'Platform Administrator' : 'Tomato User')).trim();
  const walletBalance = Math.max(0, Number(userRecord?.walletBalance ?? 0));
  let creditPoint = Math.max(0, Number(userRecord?.creditPoint ?? 0));
  if (effectiveRole === 'admin' && creditPoint < 10000) {
    creditPoint = 10000;
  }

  walletDoc = await Wallet.findOneAndUpdate(
    { userId },
    {
      $setOnInsert: {
        userId,
        name,
        role: effectiveRole,
        walletBalance,
        creditPoint,
        email: userRecord?.email || '',
        phone: userRecord?.phone || '',
      },
    },
    { upsert: true, new: true, returnDocument: 'after' },
  );

  return walletDoc!;
};

export const getAdminWalletSnapshot = async (
  adminId: string,
  currentAdmin?: IEmployee | null,
) => {
  // Ensure the admin's central record exists in 'wallet' collection
  const adminDoc = currentAdmin ?? (await Employee.findById(adminId).select(
    'name role email phone walletBalance creditPoint',
  ));
  const adminWallet = await getOrCreateUserWallet(adminId, 'admin', adminDoc?.name);

  // 1. Attempt to find existing balance_snapshot by adminUserId in wallet_transfers
  let snapshot: any = await WalletCreditTrack.findOne({
    recordType: 'balance_snapshot',
    adminUserId: adminId,
  }).sort({ snapshotAt: -1, createdAt: -1 });

  // 2. If not found by adminUserId, check for unlinked snapshot or match by adminEmail
  if (!snapshot) {
    const adminEmail = adminDoc?.email?.trim();
    const queryConditions: any[] = [
      { adminUserId: null },
      { adminUserId: '' },
      { adminUserId: { $exists: false } },
    ];
    if (adminEmail) {
      queryConditions.push({
        adminEmail: { $regex: `^${escapeRegex(adminEmail)}$`, $options: 'i' },
      });
    }

    snapshot = await WalletCreditTrack.findOne({
      recordType: 'balance_snapshot',
      $or: queryConditions,
    }).sort({ snapshotAt: -1, createdAt: -1 });

    if (snapshot) {
      snapshot.adminUserId = adminId;
      if (!snapshot.adminEmail && adminDoc?.email) snapshot.adminEmail = adminDoc.email;
      if (!snapshot.adminMobile && adminDoc?.phone) snapshot.adminMobile = adminDoc.phone;
      await snapshot.save();
    }
  }

  const effectiveCreditPoints =
    typeof adminWallet?.creditPoint === 'number'
      ? Math.max(0, adminWallet.creditPoint)
      : typeof snapshot?.creditPoint === 'number'
        ? Math.max(0, snapshot.creditPoint)
        : typeof snapshot?.credit_point === 'number'
          ? Math.max(0, snapshot.credit_point)
          : typeof adminDoc?.creditPoint === 'number'
            ? Math.max(0, adminDoc.creditPoint)
            : 10000;

  const effectiveWalletBalance =
    typeof adminWallet?.walletBalance === 'number'
      ? Math.max(0, adminWallet.walletBalance)
      : typeof snapshot?.walletBalance === 'number'
        ? Math.max(0, snapshot.walletBalance)
        : typeof snapshot?.wallet_balance === 'number'
          ? Math.max(0, snapshot.wallet_balance)
          : typeof adminDoc?.walletBalance === 'number'
            ? Math.max(0, adminDoc.walletBalance)
            : 0;

  // If no snapshot exists at all, auto-initialize
  if (!snapshot) {
    try {
      snapshot = await WalletCreditTrack.findOneAndUpdate(
        {
          recordType: 'balance_snapshot',
          adminUserId: adminId,
        },
        {
          $setOnInsert: {
            recordType: 'balance_snapshot',
            adminUserId: adminId,
            adminEmail: adminDoc?.email ?? '',
            adminMobile: adminDoc?.phone ?? '',
            wallet_balance: effectiveWalletBalance,
            walletBalance: effectiveWalletBalance,
            credit_point: effectiveCreditPoints,
            creditPoint: effectiveCreditPoints,
            snapshotAt: new Date(),
          },
        },
        { upsert: true, new: true, returnDocument: 'after' },
      );
    } catch {
      snapshot = await WalletCreditTrack.findOne({
        recordType: 'balance_snapshot',
      }).sort({ snapshotAt: -1, createdAt: -1 });
    }
  }

  // Ensure snapshot, Employee, and Wallet table are strictly in sync
  if (snapshot) {
    if (
      Number(snapshot.credit_point) !== effectiveCreditPoints ||
      Number(snapshot.creditPoint) !== effectiveCreditPoints ||
      Number(snapshot.wallet_balance) !== effectiveWalletBalance ||
      Number(snapshot.walletBalance) !== effectiveWalletBalance
    ) {
      snapshot.credit_point = effectiveCreditPoints;
      snapshot.creditPoint = effectiveCreditPoints;
      snapshot.wallet_balance = effectiveWalletBalance;
      snapshot.walletBalance = effectiveWalletBalance;
      await WalletCreditTrack.updateOne(
        { _id: snapshot._id },
        {
          $set: {
            credit_point: effectiveCreditPoints,
            creditPoint: effectiveCreditPoints,
            wallet_balance: effectiveWalletBalance,
            walletBalance: effectiveWalletBalance,
            snapshotAt: new Date(),
          },
        },
      );
    }
  }

  if (
    adminWallet &&
    (Number(adminWallet.creditPoint) !== effectiveCreditPoints ||
      Number(adminWallet.walletBalance) !== effectiveWalletBalance)
  ) {
    adminWallet.creditPoint = effectiveCreditPoints;
    adminWallet.walletBalance = effectiveWalletBalance;
    await adminWallet.save();
  }

  if (
    adminDoc &&
    (Number(adminDoc.creditPoint) !== effectiveCreditPoints ||
      Number(adminDoc.walletBalance) !== effectiveWalletBalance)
  ) {
    await Employee.updateOne(
      { _id: adminId },
      { $set: { creditPoint: effectiveCreditPoints, walletBalance: effectiveWalletBalance } },
    );
    adminDoc.creditPoint = effectiveCreditPoints;
    adminDoc.walletBalance = effectiveWalletBalance;
  }

  return snapshot || {
    wallet_balance: effectiveWalletBalance,
    walletBalance: effectiveWalletBalance,
    credit_point: effectiveCreditPoints,
    creditPoint: effectiveCreditPoints,
  };
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
  if (!userId || !mongoose.isValidObjectId(userId)) {
    throw new WalletServiceError('Valid user ID is required', 401);
  }

  const walletDoc = await getOrCreateUserWallet(userId, role);
  return {
    walletBalance: Math.max(0, Number(walletDoc.walletBalance ?? 0)),
    creditPoint: Math.max(0, Number(walletDoc.creditPoint ?? 0)),
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
    Employee.findOne({ _id: adminId, role: { $in: ['admin', 'subadmin'] } }).select(
      'name role email phone walletBalance creditPoint',
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

  // Ensure admin's central Wallet document is initialized
  const adminWallet = await getOrCreateUserWallet(adminId, 'admin', currentAdmin.name);
  const currentSnapshot = await getAdminWalletSnapshot(adminId, currentAdmin);

  // Atomically debit admin wallet in both Wallet collection and snapshot
  const updatedAdminWallet = await Wallet.findOneAndUpdate(
    {
      userId: adminId,
      creditPoint: { $gte: creditPoints },
    },
    {
      $inc: { creditPoint: -creditPoints },
    },
    { returnDocument: 'after' },
  );

  if (!updatedAdminWallet) {
    throw new WalletServiceError(
      'Insufficient credit points in the admin wallet',
      409,
    );
  }

  const updatedSnapshot = await WalletCreditTrack.findOneAndUpdate(
    {
      _id: currentSnapshot._id,
      recordType: 'balance_snapshot',
    },
    {
      $inc: { credit_point: -creditPoints, creditPoint: -creditPoints },
      $set: { snapshotAt: new Date() },
    },
    { returnDocument: 'after' },
  );

  // Sync Employee document as well
  await Employee.updateOne(
    { _id: adminId },
    { $inc: { creditPoint: -creditPoints } },
  ).catch((err) => console.warn('Employee credit decrement warning:', err));

  const recipientUserId = String(recipient.record._id);
  let updatedRecipient: ICustomer | IRestaurant | IShop | IRider | IEmployee | null = null;
  let updatedRecipientWallet: IWallet | null = null;

  try {
    // 1. Update recipient in their respective collection
    updatedRecipient = await adjustRecipientCredit(recipient, creditPoints);
    if (!updatedRecipient) {
      throw new WalletServiceError(
        'Recipient wallet could not be updated; transfer cancelled',
        409,
      );
    }

    // 2. Update recipient in the central 'wallet' collection
    updatedRecipientWallet = await Wallet.findOneAndUpdate(
      { userId: recipientUserId },
      {
        $inc: { creditPoint: creditPoints },
        $setOnInsert: {
          userId: recipientUserId,
          name: updatedRecipient.name || recipient.record.name || 'Tomato User',
          role: updatedRecipient.role || recipient.record.role,
          walletBalance: Math.max(0, Number(updatedRecipient.walletBalance ?? 0)),
          email: updatedRecipient.email || recipient.record.email || '',
          phone: updatedRecipient.phone || recipient.record.phone || '',
        },
      },
      { upsert: true, new: true, returnDocument: 'after' },
    );

    // 3. Log transfer record in 'wallet_transfers' collection
    await WalletCreditTrack.create({
      recordType: 'transfer',
      transferType: 'credit_point',
      senderUserId: adminId,
      senderName: currentAdmin.name || 'Platform Administrator',
      senderRole: currentAdmin.role || 'admin',
      senderEmail: currentAdmin.email ?? '',
      senderMobile: currentAdmin.phone ?? '',
      receiverUserId: recipientUserId,
      receiverName: updatedRecipientWallet?.name || updatedRecipient.name || 'User',
      receiverRole: updatedRecipientWallet?.role || updatedRecipient.role || 'customer',
      receiverEmail: updatedRecipientWallet?.email || updatedRecipient.email || '',
      receiverMobile: updatedRecipientWallet?.phone || updatedRecipient.phone || '',
      senderCurrentWalletBalance: Number(updatedAdminWallet.walletBalance ?? 0),
      senderCurrentCreditBalance: Number(updatedAdminWallet.creditPoint ?? 0),
      receiverCurrentWalletBalance: Number(
        updatedRecipientWallet?.walletBalance ?? updatedRecipient.walletBalance ?? 0,
      ),
      receiverCurrentCreditBalance: Number(
        updatedRecipientWallet?.creditPoint ?? updatedRecipient.creditPoint ?? 0,
      ),
      creditTransferred: creditPoints,
      amount: creditPoints,
      purpose,
      orderNumber,
    });
  } catch (transferError) {
    if (updatedRecipient) {
      try {
        await adjustRecipientCredit(recipient, -creditPoints, '_id');
        await Wallet.updateOne({ userId: recipientUserId }, { $inc: { creditPoint: -creditPoints } });
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
      await Wallet.updateOne(
        { userId: adminId },
        { $inc: { creditPoint: creditPoints } },
      );
      await Employee.updateOne(
        { _id: adminId },
        { $inc: { creditPoint: creditPoints } },
      ).catch((err) => console.error('Admin employee credit rollback warning:', err));

      if (updatedSnapshot?._id) {
        await WalletCreditTrack.updateOne(
          { _id: updatedSnapshot._id, recordType: 'balance_snapshot' },
          {
            $inc: { credit_point: creditPoints, creditPoint: creditPoints },
            $set: { snapshotAt: new Date() },
          },
        );
      }
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
    adminCreditPoint: Math.max(0, Number(updatedAdminWallet.creditPoint ?? 0)),
    recipient: {
      id: recipientUserId,
      name: updatedRecipientWallet?.name || updatedRecipient.name,
      role: updatedRecipientWallet?.role || updatedRecipient.role,
      creditPoint: Math.max(0, Number(updatedRecipientWallet?.creditPoint ?? updatedRecipient.creditPoint ?? 0)),
    },
  };
};

export interface WalletBalanceTransferResult {
  senderWalletBalance: number;
  recipient: {
    id: string;
    name: string;
    role: string;
    walletBalance: number;
  };
}

export const transferWalletBalance = async (
  senderId: string,
  recipientId: string,
  amountValue: unknown,
  purposeValue: unknown,
  orderNumberValue: unknown,
): Promise<WalletBalanceTransferResult> => {
  if (!mongoose.isValidObjectId(senderId)) {
    throw new WalletServiceError('Valid sender ID is required', 401);
  }
  const lookupId = recipientId.trim();
  if (!lookupId || lookupId.length > 128) {
    throw new WalletServiceError('Recipient user ID is required', 400);
  }
  const amount = Number(amountValue);
  if (typeof amount !== 'number' || isNaN(amount) || amount <= 0) {
    throw new WalletServiceError('Amount must be a positive number', 400);
  }
  const roundedAmount = Number(amount.toFixed(2));
  const purpose = typeof purposeValue === 'string' ? purposeValue.trim() : '';
  const orderNumber = typeof orderNumberValue === 'string' ? orderNumberValue.trim() : '';
  if (!purpose || purpose.length > 500) {
    throw new WalletServiceError('Transfer purpose is required and must be 500 characters or fewer', 400);
  }
  if (orderNumber.length > 100) {
    throw new WalletServiceError('Order number must be 100 characters or fewer', 400);
  }

  const [recipient, senderAdmin] = await Promise.all([
    findRecipientAccount(lookupId),
    Employee.findById(senderId).select('name role email phone walletBalance creditPoint'),
  ]);

  if (!recipient) {
    throw new WalletServiceError('Recipient user was not found', 404);
  }

  // Get or create sender wallet in central 'wallet' table
  const senderWallet = await getOrCreateUserWallet(senderId, senderAdmin?.role || 'admin', senderAdmin?.name);
  if (Number(senderWallet.walletBalance || 0) < roundedAmount) {
    throw new WalletServiceError(
      `Insufficient wallet balance. Available: ₹${Number(senderWallet.walletBalance || 0).toFixed(2)}, Requested: ₹${roundedAmount.toFixed(2)}`,
      409,
    );
  }

  // Atomically debit sender wallet
  const updatedSenderWallet = await Wallet.findOneAndUpdate(
    {
      userId: senderId,
      walletBalance: { $gte: roundedAmount },
    },
    {
      $inc: { walletBalance: -roundedAmount },
    },
    { returnDocument: 'after' },
  );

  if (!updatedSenderWallet) {
    throw new WalletServiceError('Insufficient wallet balance in sender account', 409);
  }

  // Also sync Employee or sender model
  if (senderAdmin) {
    await Employee.updateOne({ _id: senderId }, { $inc: { walletBalance: -roundedAmount } }).catch(() => {});
  }

  const recipientUserId = String(recipient.record._id);
  let updatedRecipientWallet: IWallet | null = null;

  try {
    // 1. Credit recipient in their specific model
    const incObj = { $inc: { walletBalance: roundedAmount } };
    if (recipient.model === 'customer') await Customer.findByIdAndUpdate(recipientUserId, incObj);
    else if (recipient.model === 'restaurant') await Restaurant.findByIdAndUpdate(recipientUserId, incObj);
    else if (recipient.model === 'shop') await Shop.findByIdAndUpdate(recipientUserId, incObj);
    else if (recipient.model === 'rider') await Rider.findByIdAndUpdate(recipientUserId, incObj);
    else if (recipient.model === 'employee') await Employee.findByIdAndUpdate(recipientUserId, incObj);

    // 2. Credit recipient in central Wallet collection
    updatedRecipientWallet = await Wallet.findOneAndUpdate(
      { userId: recipientUserId },
      {
        $inc: { walletBalance: roundedAmount },
        $setOnInsert: {
          userId: recipientUserId,
          name: recipient.record.name || 'Tomato User',
          role: recipient.record.role,
          creditPoint: Math.max(0, Number(recipient.record.creditPoint ?? 0)),
          email: recipient.record.email || '',
          phone: recipient.record.phone || '',
        },
      },
      { upsert: true, new: true, returnDocument: 'after' },
    );

    // 3. Log transfer record in wallet_transfers
    await WalletCreditTrack.create({
      recordType: 'transfer',
      transferType: 'wallet_balance',
      senderUserId: senderId,
      senderName: senderAdmin?.name || updatedSenderWallet.name || 'Platform Administrator',
      senderRole: senderAdmin?.role || updatedSenderWallet.role || 'admin',
      senderEmail: senderAdmin?.email ?? updatedSenderWallet.email ?? '',
      senderMobile: senderAdmin?.phone ?? updatedSenderWallet.phone ?? '',
      receiverUserId: recipientUserId,
      receiverName: updatedRecipientWallet?.name || recipient.record.name || 'User',
      receiverRole: updatedRecipientWallet?.role || recipient.record.role || 'customer',
      receiverEmail: updatedRecipientWallet?.email || recipient.record.email || '',
      receiverMobile: updatedRecipientWallet?.phone || recipient.record.phone || '',
      senderCurrentWalletBalance: Number(updatedSenderWallet.walletBalance ?? 0),
      senderCurrentCreditBalance: Number(updatedSenderWallet.creditPoint ?? 0),
      receiverCurrentWalletBalance: Number(updatedRecipientWallet?.walletBalance ?? 0),
      receiverCurrentCreditBalance: Number(updatedRecipientWallet?.creditPoint ?? 0),
      creditTransferred: roundedAmount,
      walletBalanceTransferred: roundedAmount,
      amount: roundedAmount,
      purpose,
      orderNumber,
    });
  } catch (transferError) {
    // Rollback recipient
    const decObj = { $inc: { walletBalance: -roundedAmount } };
    if (recipient.model === 'customer') await Customer.findByIdAndUpdate(recipientUserId, decObj).catch(() => {});
    else if (recipient.model === 'restaurant') await Restaurant.findByIdAndUpdate(recipientUserId, decObj).catch(() => {});
    else if (recipient.model === 'shop') await Shop.findByIdAndUpdate(recipientUserId, decObj).catch(() => {});
    else if (recipient.model === 'rider') await Rider.findByIdAndUpdate(recipientUserId, decObj).catch(() => {});
    else if (recipient.model === 'employee') await Employee.findByIdAndUpdate(recipientUserId, decObj).catch(() => {});

    await Wallet.updateOne({ userId: recipientUserId }, { $inc: { walletBalance: -roundedAmount } }).catch(() => {});

    // Rollback sender
    await Wallet.updateOne({ userId: senderId }, { $inc: { walletBalance: roundedAmount } }).catch(() => {});
    if (senderAdmin) {
      await Employee.updateOne({ _id: senderId }, { $inc: { walletBalance: roundedAmount } }).catch(() => {});
    }

    throw transferError;
  }

  return {
    senderWalletBalance: Math.max(0, Number(updatedSenderWallet.walletBalance ?? 0)),
    recipient: {
      id: recipientUserId,
      name: updatedRecipientWallet?.name || recipient.record.name,
      role: updatedRecipientWallet?.role || recipient.record.role,
      walletBalance: Math.max(0, Number(updatedRecipientWallet?.walletBalance ?? 0)),
    },
  };
};
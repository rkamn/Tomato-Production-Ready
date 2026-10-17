import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Address from '../../../model/Address.js';
import MenuItem, { FoodItem } from '../../../model/MenuItem.js';
import Customer, { ICustomer } from '../../../model/Customer.js';
import Restaurant, { IRestaurant } from '../../../model/Restaurant.js';
import Shop, { IShop } from '../../../model/Shop.js';
import Rider, { IRider } from '../../../model/Rider.js';
import Employee, { IEmployee, USER_ROLES, UserRole } from '../../../model/Employee.js';
import Notification from '../../../model/Notification.js';
import Order from '../../../model/Order.js';
import { AuthenticatedRequest, requireRole, requirePermission } from '../../../middleware/authenticate.js';
import {
  hashPassword,
  userResponse,
  generateRestaurantId,
  generateShopId,
  generateRiderId,
  generateCustomerId,
  generateSubAdminId,
  generateAdminId,
} from '../../auth/authController.js';
import {
  transferCreditPoints,
  getOrCreateUserWallet,
  WalletServiceError,
} from '../../wallet/walletService.js';
import {
  validateBankAndPanDetails,
  checkPartnerCanBeApproved,
  extractPincodeFromText,
  getServiceablePincodes,
  resolvePartnerPincode,
} from '../../../utils/bankHelpers.js';

const router = Router();

  // 3. User management: List, Add, Update, Approve, Block (with pagination)
  router.get('/users', async (req: Request, res: Response) => {
    try {
      const currentUser = (req as AuthenticatedRequest).user;
      const { role, search, page, limit, all } = req.query;

      const pageParam = parseInt(String(page || '1'), 10);
      const pageNum =
        Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
      const limitParam = parseInt(String(limit || '10'), 10);
      const pageSize =
        Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10;
      const isAll = all === 'true';

      const paginateList = (list: any[]) => {
        const totalItems = list.length;
        if (isAll) {
          return {
            users: list,
            totalMatching: totalItems,
            pagination: {
              currentPage: 1,
              totalPages: 1,
              totalItems,
              pageSize: totalItems,
              hasNextPage: false,
              hasPrevPage: false,
            },
          };
        }
        const totalPages = Math.ceil(totalItems / pageSize) || 1;
        const safePage = Math.min(pageNum, totalPages);
        const paginatedUsers = list.slice(
          (safePage - 1) * pageSize,
          safePage * pageSize,
        );
        return {
          users: paginatedUsers,
          totalMatching: totalItems,
          pagination: {
            currentPage: safePage,
            totalPages,
            totalItems,
            pageSize,
            hasNextPage: safePage < totalPages,
            hasPrevPage: safePage > 1,
          },
        };
      };

      if (currentUser?.role === 'subadmin') {
        const perms = currentUser.permissions || [];
        if (role === 'restaurant' && !perms.includes('restaurants_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires restaurants_manage permission.',
            });
        }
        if (role === 'shop' && !perms.includes('shops_manage') && !perms.includes('restaurants_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires shops_manage or restaurants_manage permission.',
            });
        }
        if (role === 'deliveryPartner' && !perms.includes('riders_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires riders_manage permission.',
            });
        }
        if (role === 'customer' && !perms.includes('customers_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires customers_manage permission.',
            });
        }
        if (role === 'subadmin' && !perms.includes('subadmins_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires subadmins_manage permission.',
            });
        }
      }

      if (role === 'restaurant') {
        const restFilter: Record<string, unknown> = {};
        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { restaurantId: { $regex: escaped, $options: 'i' } },
            { digipin: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
          }
          restFilter.$or = orConditions;
        }
        const restaurants = await Restaurant.find(restFilter).sort({ createdAt: -1 });
        return res.json(paginateList(restaurants.map((r) => userResponse(r as any))));
      }

      if (role === 'shop') {
        const shopFilter: Record<string, unknown> = {};
        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { shopId: { $regex: escaped, $options: 'i' } },
            { digipin: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
          }
          shopFilter.$or = orConditions;
        }
        const shops = await Shop.find(shopFilter).sort({ createdAt: -1 });
        return res.json(paginateList(shops.map((s) => userResponse(s as any))));
      }

      if (role === 'customer') {
        const custFilter: Record<string, unknown> = {};
        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { customerId: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
          }
          custFilter.$or = orConditions;
        }
        const customers = await Customer.find(custFilter).sort({ createdAt: -1 });
        return res.json(paginateList(customers.map((c) => userResponse(c as any))));
      }

      if (role === 'deliveryPartner') {
        const riderFilter: Record<string, unknown> = {};
        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { riderId: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
          }
          riderFilter.$or = orConditions;
        }
        const riders = await Rider.find(riderFilter).sort({ createdAt: -1 });
        return res.json(paginateList(riders.map((r) => userResponse(r as any))));
      }

      const filter: Record<string, unknown> = {};
      if (typeof role === 'string' && USER_ROLES.includes(role as UserRole)) {
        filter.role = role;
      }

      if (typeof search === 'string' && search.trim()) {
        const term = search.trim();
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const orConditions: any[] = [
          { name: { $regex: escaped, $options: 'i' } },
          { email: { $regex: escaped, $options: 'i' } },
          { phone: { $regex: escaped, $options: 'i' } },
          { restaurantId: { $regex: escaped, $options: 'i' } },
          { riderId: { $regex: escaped, $options: 'i' } },
          { customerId: { $regex: escaped, $options: 'i' } },
          { subadminId: { $regex: escaped, $options: 'i' } },
          {
            $expr: {
              $regexMatch: {
                input: { $toString: '$_id' },
                regex: escaped,
                options: 'i',
              },
            },
          },
        ];
        if (mongoose.isValidObjectId(term)) {
          orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
        }
        filter.$or = orConditions;
      }

      if (!role) {
        const restFilter: Record<string, unknown> = {};
        const shopFilter: Record<string, unknown> = {};
        const riderFilter: Record<string, unknown> = {};
        const custFilter: Record<string, unknown> = {};

        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const commonOr: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            commonOr.push({ _id: new mongoose.Types.ObjectId(term) });
          }

          restFilter.$or = [
            ...commonOr,
            { restaurantId: { $regex: escaped, $options: 'i' } },
            { digipin: { $regex: escaped, $options: 'i' } },
          ];
          shopFilter.$or = [
            ...commonOr,
            { shopId: { $regex: escaped, $options: 'i' } },
            { digipin: { $regex: escaped, $options: 'i' } },
          ];
          riderFilter.$or = [
            ...commonOr,
            { riderId: { $regex: escaped, $options: 'i' } },
          ];
          custFilter.$or = [
            ...commonOr,
            { customerId: { $regex: escaped, $options: 'i' } },
          ];
        }

        const [employees, restaurants, shops, riders, customers] = await Promise.all([
          Employee.find(filter).sort({ createdAt: -1 }),
          Restaurant.find(restFilter).sort({ createdAt: -1 }),
          Shop.find(shopFilter).sort({ createdAt: -1 }),
          Rider.find(riderFilter).sort({ createdAt: -1 }),
          Customer.find(custFilter).sort({ createdAt: -1 }),
        ]);

        const combined = [
          ...employees.map((u) => userResponse(u as any)),
          ...restaurants.map((r) => userResponse(r as any)),
          ...shops.map((s) => userResponse(s as any)),
          ...riders.map((r) => userResponse(r as any)),
          ...customers.map((c) => userResponse(c as any)),
        ];
        combined.sort(
          (a: any, b: any) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );
        return res.json(paginateList(combined));
      }

      const employees = await Employee.find(filter).sort({ createdAt: -1 });
      return res.json(paginateList(employees.map((u) => userResponse(u as any))));
    } catch (error) {
      console.error('Admin users fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch users' });
    }
  });

  // Add new user / restaurant / rider directly by Admin
  router.post('/users', async (req: Request, res: Response) => {
    try {
      const {
        name,
        email,
        phone,
        password,
        role,
        restaurantAddress,
        cuisine,
        deliveryVehicle,
      } = req.body;
      if (!name || (!email && !phone) || !password || !role) {
        return res.status(400).json({
          message: 'Name, email/phone, password, and role are required',
        });
      }

      const currentUser = (req as AuthenticatedRequest).user;
      if (currentUser?.role === 'subadmin' && role === 'admin') {
        return res.status(403).json({
          message: 'Access denied. Sub-admins cannot create administrator accounts.',
        });
      }

      const duplicateQuery = {
        $or: [
          ...(email ? [{ email: email.trim().toLowerCase() }] : []),
          ...(phone ? [{ phone: phone.trim() }] : []),
        ],
      };

      const [
        existingEmployee,
        existingRestaurant,
        existingShop,
        existingRider,
        existingCustomer,
      ] = await Promise.all([
        Employee.findOne(duplicateQuery),
        Restaurant.findOne(duplicateQuery),
        Shop.findOne(duplicateQuery),
        Rider.findOne(duplicateQuery),
        Customer.findOne(duplicateQuery),
      ]);

      if (
        existingEmployee ||
        existingRestaurant ||
        existingShop ||
        existingRider ||
        existingCustomer
      ) {
        return res
          .status(409)
          .json({ message: 'Account with that email or phone already exists' });
      }

      if (role === 'restaurant') {
        const restaurantId = await generateRestaurantId();
        let digipin =
          typeof req.body?.digipin === 'string'
            ? req.body.digipin.trim().toUpperCase()
            : '';
        let restaurantLocation: { lat: number; lng: number } = {
          lat: 12.9716,
          lng: 77.5946,
        };
        const rawLat = req.body?.restaurantLocation?.lat ?? req.body?.lat;
        const rawLng = req.body?.restaurantLocation?.lng ?? req.body?.lng;
        if (
          rawLat !== undefined &&
          rawLng !== undefined &&
          !isNaN(Number(rawLat)) &&
          !isNaN(Number(rawLng))
        ) {
          restaurantLocation = { lat: Number(rawLat), lng: Number(rawLng) };
        }
        if (!digipin) {
          digipin = `DGP-${Math.round(restaurantLocation.lat * 100)}-${Math.round(restaurantLocation.lng * 100)}`;
        }

        const rAddr = restaurantAddress ? restaurantAddress.trim() : '';
        const rPincode =
          extractPincodeFromText(req.body?.pincode) ||
          extractPincodeFromText(rAddr) ||
          '';
        const serviceablePincodes = await getServiceablePincodes();
        const isPincodeServiceable =
          Boolean(rPincode) && serviceablePincodes.includes(rPincode);
        const restBankCheck = validateBankAndPanDetails(req.body?.bankDetails);
        const canAutoApprove = restBankCheck.valid && isPincodeServiceable;

        const restaurant = await Restaurant.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'restaurant',
          isApproved: canAutoApprove,
          isBlocked: false,
          restaurantId,
          digipin,
          pincode: rPincode,
          restaurantAddress: rAddr,
          restaurantLocation,
          cuisine: cuisine ? cuisine.trim() : 'Multi-cuisine',
          isOpen: true,
          isOnline: true,
          ...(restBankCheck.valid && restBankCheck.sanitized
            ? {
                bankDetails: {
                  ...restBankCheck.sanitized,
                  isSubmitted: true,
                  isApproved: canAutoApprove,
                  isLocked: canAutoApprove,
                  agreementCommissionPercent: 15,
                  submittedAt: new Date(),
                  ...(canAutoApprove
                    ? {
                        approvedAt: new Date(),
                        approvedBy: currentUser?.name || 'Admin',
                      }
                    : {}),
                },
              }
            : {}),
        });
        await getOrCreateUserWallet(String(restaurant._id), 'restaurant', restaurant.name).catch(() => {});

        return res.status(201).json({
          message: canAutoApprove
            ? 'Restaurant created and approved with verified Bank, PAN & serviceable pincode'
            : restBankCheck.valid && !isPincodeServiceable
              ? `Restaurant created (Pending approval: pincode "${rPincode || 'N/A'}" is not in serviceable range)`
              : 'Restaurant created (Pending Bank & PAN submission and serviceable pincode check for approval)',
          user: userResponse(restaurant as any),
        });
      }

      if (role === 'shop') {
        const shopId = await generateShopId();
        let digipin =
          typeof req.body?.digipin === 'string'
            ? req.body.digipin.trim().toUpperCase()
            : '';
        let shopLocation: { lat: number; lng: number } = {
          lat: 12.9716,
          lng: 77.5946,
        };
        const rawLat = req.body?.shopLocation?.lat ?? req.body?.restaurantLocation?.lat ?? req.body?.lat;
        const rawLng = req.body?.shopLocation?.lng ?? req.body?.restaurantLocation?.lng ?? req.body?.lng;
        if (
          rawLat !== undefined &&
          rawLng !== undefined &&
          !isNaN(Number(rawLat)) &&
          !isNaN(Number(rawLng))
        ) {
          shopLocation = { lat: Number(rawLat), lng: Number(rawLng) };
        }
        if (!digipin) {
          digipin = `DGP-${Math.round(shopLocation.lat * 100)}-${Math.round(shopLocation.lng * 100)}`;
        }
        const sAddress = (req.body?.shopAddress || req.body?.restaurantAddress || '').trim();
        const sPincode =
          extractPincodeFromText(req.body?.pincode) ||
          extractPincodeFromText(sAddress) ||
          '';
        const serviceablePincodes = await getServiceablePincodes();
        const isPincodeServiceable =
          Boolean(sPincode) && serviceablePincodes.includes(sPincode);
        const sCategory = req.body?.category || req.body?.cuisine || 'Retail, Supermarket & Groceries';
        const shopBankCheck = validateBankAndPanDetails(req.body?.bankDetails);
        const canAutoApprove = shopBankCheck.valid && isPincodeServiceable;

        const shop = await Shop.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'shop',
          isApproved: canAutoApprove,
          isBlocked: false,
          shopId,
          digipin,
          pincode: sPincode,
          shopAddress: sAddress,
          shopLocation,
          category: sCategory.trim(),
          isOpen: true,
          isOnline: true,
          ...(shopBankCheck.valid && shopBankCheck.sanitized
            ? {
                bankDetails: {
                  ...shopBankCheck.sanitized,
                  isSubmitted: true,
                  isApproved: canAutoApprove,
                  isLocked: canAutoApprove,
                  agreementCommissionPercent: 12,
                  submittedAt: new Date(),
                  ...(canAutoApprove
                    ? {
                        approvedAt: new Date(),
                        approvedBy: currentUser?.name || 'Admin',
                      }
                    : {}),
                },
              }
            : {}),
        });
        await getOrCreateUserWallet(String(shop._id), 'shop', shop.name).catch(() => {});

        return res.status(201).json({
          message: canAutoApprove
            ? 'Shop created and approved with verified Bank, PAN & serviceable pincode'
            : shopBankCheck.valid && !isPincodeServiceable
              ? `Shop created (Pending approval: pincode "${sPincode || 'N/A'}" is not in serviceable range)`
              : 'Shop created (Pending Bank & PAN submission and serviceable pincode check for approval)',
          user: userResponse(shop as any),
        });
      }

      if (role === 'customer') {
        const customerId = await generateCustomerId();
        const customer = await Customer.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'customer',
          isApproved: true,
          isBlocked: false,
          customerId,
        } as unknown as ICustomer);
        await getOrCreateUserWallet(String(customer._id), 'customer', customer.name).catch(() => {});

        return res.status(201).json({
          message: 'Customer created successfully',
          user: userResponse(customer as any),
        });
      }

      if (role === 'deliveryPartner') {
        const riderId = await generateRiderId();
        let currentLocation: { lat: number; lng: number } = {
          lat: 12.9716,
          lng: 77.5946,
        };
        const rLat = req.body?.currentLocation?.lat ?? req.body?.lat;
        const rLng = req.body?.currentLocation?.lng ?? req.body?.lng;
        if (rLat !== undefined && rLng !== undefined && !isNaN(Number(rLat))) {
          currentLocation = { lat: Number(rLat), lng: Number(rLng) };
        }
        const riderBankCheck = validateBankAndPanDetails(req.body?.bankDetails);

        const rider = await Rider.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'deliveryPartner',
          isApproved: riderBankCheck.valid,
          isBlocked: false,
          riderId,
          deliveryVehicle: deliveryVehicle
            ? deliveryVehicle.trim()
            : 'motorcycle',
          currentLocation,
          isOnline: true,
          lastLocationUpdated: new Date(),
          ...(riderBankCheck.valid && riderBankCheck.sanitized
            ? {
                bankDetails: {
                  ...riderBankCheck.sanitized,
                  isSubmitted: true,
                  isApproved: true,
                  isLocked: true,
                  riderPayoutPerOrder: 40,
                  submittedAt: new Date(),
                  approvedAt: new Date(),
                  approvedBy: currentUser?.name || 'Admin',
                },
              }
            : {}),
        } as unknown as IRider);
        await getOrCreateUserWallet(String(rider._id), 'deliveryPartner', rider.name).catch(() => {});

        return res.status(201).json({
          message: riderBankCheck.valid
            ? 'Delivery partner created and approved with verified Bank & PAN details'
            : 'Delivery partner created (Pending Bank & PAN submission for approval)',
          user: userResponse(rider as any),
        });
      }

      const adminId = role === 'admin' ? await generateAdminId() : undefined;
      const subadminId = role === 'subadmin' ? await generateSubAdminId() : undefined;
      const employeeData: Record<string, unknown> = {
        name: name.trim(),
        email: email ? email.trim().toLowerCase() : undefined,
        phone: phone ? phone.trim() : undefined,
        passwordHash: await hashPassword(password),
        role,
        adminRoleTitle:
          role === 'admin'
            ? 'Platform Administrator'
            : 'Operations Sub-Admin',
        isApproved: true,
        isBlocked: false,
        permissions: role === 'admin' ? ['*'] : ['orders_manage'],
        ...(adminId ? { adminId } : {}),
        ...(subadminId ? { subadminId } : {}),
      };

      const employee = await Employee.create(employeeData);
      await getOrCreateUserWallet(String(employee._id), employee.role, employee.name).catch(() => {});

      return res.status(201).json({
        message: 'Account created successfully in Employees table',
        user: userResponse(employee as any),
      });
    } catch (error) {
      console.error('Admin create user failed:', error);
      return res.status(500).json({ message: 'Unable to create user' });
    }
  });

  // Update user
  router.post(
    '/users/:userId/credit-points',
    requireRole('admin'),
    async (req: Request, res: Response) => {
      const adminId = (req as AuthenticatedRequest).user?.userId;
      const recipientId = String(req.params.userId || '');

      if (!adminId) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      if (!recipientId.trim() || recipientId.length > 128) {
        return res.status(400).json({ message: 'Recipient user ID is required' });
      }

      try {
        const rawPoints = req.body?.creditPoints;
        const creditPoints = typeof rawPoints === 'string' ? parseInt(rawPoints, 10) : Number(rawPoints);
        const transfer = await transferCreditPoints(
          adminId,
          recipientId,
          creditPoints,
          req.body?.purpose,
          req.body?.orderNumber,
        );
        return res.json({
          message: `Transferred ${creditPoints} credit point(s) successfully`,
          ...transfer,
        });
      } catch (error: any) {
        if (error instanceof WalletServiceError || error?.name === 'WalletServiceError') {
          return res.status(error.statusCode || 400).json({ message: error.message });
        }
        console.error('Admin credit-point transfer failed:', error);
        return res.status(500).json({ message: 'Unable to transfer credit points' });
      }
    },
  );

  router.put('/users/:userId', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Sub-admin can NEVER modify or update permissions of an admin account:
      const targetUser = await Employee.findById(userId);
      if (targetUser && targetUser.role === 'admin') {
        if (currentUser?.role === 'subadmin') {
          return res.status(403).json({
            message: 'Access denied. Sub-admins can never delete, modify, or update permissions of administrator accounts.',
          });
        }
      }

      // Sub-admin can never elevate any account to admin role:
      if (currentUser?.role === 'subadmin' && req.body.role === 'admin') {
        return res.status(403).json({
          message: 'Access denied. Sub-admins cannot assign or elevate to the administrator role.',
        });
      }

      // Sub-admin can never modify permissions or operational titles:
      if (
        currentUser?.role === 'subadmin' &&
        (req.body.permissions !== undefined || req.body.adminRoleTitle !== undefined)
      ) {
        return res.status(403).json({
          message: 'Access denied. Sub-admins cannot modify administrator or operational permissions.',
        });
      }

      const {
        name,
        email,
        phone,
        role,
        restaurantAddress,
        cuisine,
        deliveryVehicle,
        digipin,
        pincode,
      } = req.body;

      const updates: Record<string, unknown> = {};
      if (name) updates.name = name.trim();
      if (email) updates.email = email.trim().toLowerCase();
      if (phone) updates.phone = phone.trim();
      if (role && USER_ROLES.includes(role)) updates.role = role;
      if (restaurantAddress !== undefined)
        updates.restaurantAddress = restaurantAddress.trim();
      if (pincode !== undefined) {
        updates.pincode =
          extractPincodeFromText(pincode) || String(pincode).trim();
      } else if (restaurantAddress !== undefined) {
        const extractedPin = extractPincodeFromText(restaurantAddress);
        if (extractedPin) updates.pincode = extractedPin;
      }
      if (cuisine !== undefined) updates.cuisine = cuisine.trim();
      if (deliveryVehicle !== undefined)
        updates.deliveryVehicle = deliveryVehicle.trim();
      if (typeof digipin === 'string')
        updates.digipin = digipin.trim().toUpperCase();
      if (
        req.body?.lat !== undefined &&
        req.body?.lng !== undefined &&
        !isNaN(Number(req.body.lat))
      ) {
        updates.restaurantLocation = {
          lat: Number(req.body.lat),
          lng: Number(req.body.lng),
        };
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: updates },
        { returnDocument: 'after', runValidators: true },
      );
      if (!user) {
        const shopUpdates: Record<string, unknown> = { ...updates };
        if (req.body.shopAddress !== undefined || req.body.restaurantAddress !== undefined) {
          const nextAddr = (req.body.shopAddress || req.body.restaurantAddress || '').trim();
          shopUpdates.shopAddress = nextAddr;
          if (pincode === undefined) {
            const extractedPin = extractPincodeFromText(nextAddr);
            if (extractedPin) shopUpdates.pincode = extractedPin;
          }
        }
        if (req.body.category !== undefined || req.body.cuisine !== undefined) {
          shopUpdates.category = (req.body.category || req.body.cuisine || '').trim();
        }
        if (updates.restaurantLocation) {
          shopUpdates.shopLocation = updates.restaurantLocation;
        }
        user = await Shop.findByIdAndUpdate(
          userId,
          { $set: shopUpdates },
          { returnDocument: 'after', runValidators: true },
        );
      }
      if (user && (user.role === 'restaurant' || user.role === 'shop') && user.isApproved) {
        const serviceablePincodes = await getServiceablePincodes();
        const currentPin = resolvePartnerPincode(user);
        if (!currentPin || !serviceablePincodes.includes(currentPin)) {
          user.isApproved = false;
          await user.save();
        }
      }
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: updates },
          { returnDocument: 'after', runValidators: true },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: updates },
          { returnDocument: 'after', runValidators: true },
        );
      }
      if (!user) {
        user = await Employee.findByIdAndUpdate(
          userId,
          { $set: updates },
          { returnDocument: 'after', runValidators: true },
        );
      }
      if (!user) return res.status(404).json({ message: 'User not found' });

      return res.json({
        message: 'User updated successfully',
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Admin update user failed:', error);
      return res.status(500).json({ message: 'Unable to update user' });
    }
  });

  // Live Rider Fleet Tracking for Admin
  router.get(
    '/riders/live-locations',
    requirePermission('riders_manage'),
    async (_req: Request, res: Response) => {
      try {
        const allRiders = await Rider.find()
          .select(
            'name riderId phone email currentLocation isOnline lastLocationUpdated deliveryVehicle isApproved isBlocked',
          )
          .lean();

        // Find active orders assigned to riders
        const activeOrders = await Order.find({
          status: {
            $in: [
              'accepted',
              'preparing',
              'ready_for_pickup',
              'out_for_delivery',
            ],
          },
          riderId: { $ne: null },
        })
          .select(
            'orderNumber status riderId restaurantName restaurantLocation deliveryAddress totalAmount',
          )
          .lean();

        const orderMap = new Map();
        activeOrders.forEach((o: any) => {
          if (o.riderId) orderMap.set(String(o.riderId), o);
        });

        return res.json({
          riders: allRiders.map((r) => {
            return {
              ...userResponse(r as any),
              displayName: r.name,
              activeOrder: orderMap.get(String(r._id)) || null,
            };
          }),
        });
      } catch (error) {
        console.error('Fetch live rider locations failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch rider live locations' });
      }
    },
  );


  // Approve rider or restaurant or shop (ONLY when bank details + IFSC + PAN are submitted and Account Holder Name matches PAN Card Name, AND for Restaurant/Shop its pincode is in Admin serviceable range)
  router.post('/users/:userId/approve', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      const adminUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      const adminIdentifier =
        adminUser?.name || adminUser?.email || adminUser?.userId || 'Admin';

      let user: any = await Restaurant.findById(userId);
      let partnerLabel = 'Restaurant';
      let isStorePartner = true;

      if (!user) {
        user = await Shop.findById(userId);
        partnerLabel = 'Shop';
      }
      if (!user) {
        user = await Rider.findById(userId);
        partnerLabel = 'Delivery Partner (Rider)';
        isStorePartner = false;
      }

      if (user) {
        if (isStorePartner) {
          const serviceablePincodes = await getServiceablePincodes();
          const partnerPincode = resolvePartnerPincode(user);
          if (!partnerPincode || !serviceablePincodes.includes(partnerPincode)) {
            return res.status(400).json({
              message: `${partnerLabel} "${user.name}" pincode ${partnerPincode ? `(${partnerPincode})` : '(missing)'} is not in the serviceable range. Active serviceable pincodes: ${serviceablePincodes.join(', ') || 'None'}.`,
              code: 'PINCODE_NOT_SERVICEABLE',
              pincode: partnerPincode || '',
              serviceablePincodes,
            });
          }
          if (!user.pincode && partnerPincode) {
            user.pincode = partnerPincode;
          }
        }

        const approvalCheck = checkPartnerCanBeApproved(user.bankDetails);
        if (!approvalCheck.canApprove) {
          return res.status(400).json({
            message: `Cannot approve ${partnerLabel} "${user.name}": ${approvalCheck.reason} Please verify or fill their Bank Details, IFSC Code, Bank Account Holder Name, and matching PAN Card in the Bank panel first.`,
            code: 'BANK_KYC_REQUIRED',
          });
        }

        const plainBd = (user.bankDetails as any)?.toObject
          ? (user.bankDetails as any).toObject()
          : user.bankDetails || {};
        user.isApproved = true;
        user.bankDetails = {
          ...plainBd,
          isSubmitted: true,
          isApproved: true,
          isLocked: true,
          approvedAt: new Date(),
          approvedBy: adminIdentifier,
        };
        await user.save();
      } else {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isApproved: true } },
          { returnDocument: 'after' },
        );
        if (!user) {
          const emp = await Employee.findById(userId);
          if (emp) {
            emp.isApproved = true;
            const plainBd = (emp.bankDetails as any)?.toObject
              ? (emp.bankDetails as any).toObject()
              : emp.bankDetails || {};
            emp.bankDetails = {
              ...plainBd,
              isSubmitted: Boolean(plainBd.accountNumber || plainBd.panNumber || plainBd.isSubmitted),
              isApproved: true,
              isLocked: true,
              approvedAt: new Date(),
              approvedBy: adminIdentifier,
            };
            await emp.save();
            user = emp;
          }
        }
      }

      if (!user) return res.status(404).json({ message: 'User not found' });

      await Notification.create({
        userId: String(user._id),
        role: user.role,
        title: 'Account & Bank Details Approved!',
        message:
          'Your Tomato partner profile and bank/PAN details have been verified and approved by the administrator. Your bank details are now locked for security.',
        type: 'service',
      });

      return res.json({
        message: `${user.name} approved successfully (Bank & PAN verified and locked)`,
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Approve user failed:', error);
      return res.status(500).json({ message: 'Unable to approve user' });
    }
  });

  // Reject rider or restaurant or shop
  router.post('/users/:userId/reject', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        {
          $set: {
            isApproved: false,
            'bankDetails.isApproved': false,
            'bankDetails.isLocked': false,
          },
        },
        { returnDocument: 'after' },
      );
      if (!user) {
        user = await Shop.findByIdAndUpdate(
          userId,
          {
            $set: {
              isApproved: false,
              'bankDetails.isApproved': false,
              'bankDetails.isLocked': false,
            },
          },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          {
            $set: {
              isApproved: false,
              'bankDetails.isApproved': false,
              'bankDetails.isLocked': false,
            },
          },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isApproved: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Employee.findByIdAndUpdate(
          userId,
          { $set: { isApproved: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) return res.status(404).json({ message: 'User not found' });

      return res.json({
        message: `${user.name} approval revoked / rejected`,
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Reject user failed:', error);
      return res.status(500).json({ message: 'Unable to reject user' });
    }
  });

  // Block any rider, restaurant, shop, or customer
  router.post('/users/:userId/block', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Check if target is an administrator or sub-admin
      const targetUserRecord = await Employee.findById(userId);
      if (targetUserRecord) {
        if (targetUserRecord.role === 'admin') {
          return res.status(403).json({
            message: 'Access denied. Administrator accounts cannot be blocked or modified.',
          });
        }
        if (targetUserRecord.role === 'subadmin' && currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can block sub-admin accounts.',
          });
        }
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: { isBlocked: true } },
        { returnDocument: 'after' },
      );
      if (!user) {
        user = await Shop.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Employee.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { returnDocument: 'after' },
        );
      }
      if (!user) return res.status(404).json({ message: 'User not found' });

      await Notification.create({
        userId: String(user._id),
        role: user.role,
        title: 'Account Notice',
        message:
          'Your account access has been restricted by the administrator.',
        type: 'system',
      });

      return res.json({
        message: `${user.name} blocked successfully`,
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Block user failed:', error);
      return res.status(500).json({ message: 'Unable to block user' });
    }
  });

  // Unblock user
  router.post('/users/:userId/unblock', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Check if target is an administrator or sub-admin
      const targetUserRecord = await Employee.findById(userId);
      if (targetUserRecord) {
        if (targetUserRecord.role === 'admin') {
          return res.status(403).json({
            message: 'Access denied. Administrator accounts cannot be modified.',
          });
        }
        if (targetUserRecord.role === 'subadmin' && currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can unblock sub-admin accounts.',
          });
        }
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: { isBlocked: false } },
        { returnDocument: 'after' },
      );
      if (!user) {
        user = await Shop.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Employee.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) return res.status(404).json({ message: 'User not found' });

      await Notification.create({
        userId: String(user._id),
        role: user.role,
        title: 'Account Restored',
        message: 'Your account has been unblocked. Welcome back to Tomato!',
        type: 'service',
      });

      return res.json({
        message: `${user.name} unblocked successfully`,
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Unblock user failed:', error);
      return res.status(500).json({ message: 'Unable to unblock user' });
    }
  });

  // Delete any partner, customer, or employee account permanently (with cascade menu item deletion for restaurants and shops)
  router.delete('/users/:userId', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Check if target is an administrator or sub-admin
      const targetUserRecord = await Employee.findById(userId);
      if (targetUserRecord) {
        if (targetUserRecord.role === 'admin') {
          return res.status(403).json({
            message: 'Access denied. Administrator accounts cannot be deleted.',
          });
        }
        if (targetUserRecord.role === 'subadmin' && currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can delete sub-admin accounts.',
          });
        }
      }

      // 1. Try deleting Restaurant and cascade delete all its associated menu items
      let deletedType = '';
      let deletedName = '';
      let deletedDoc: any = await Restaurant.findByIdAndDelete(userId);
      if (deletedDoc) {
        deletedType = 'Restaurant';
        deletedName = deletedDoc.name;
        const menuResult = await FoodItem.deleteMany({ restaurantId: deletedDoc._id });
        console.log(`Cascade deleted ${menuResult.deletedCount} menu items for restaurant ${deletedDoc.name} (${deletedDoc._id})`);
      }

      // 1.5. Try deleting Shop and cascade delete all its associated items
      if (!deletedDoc) {
        deletedDoc = await Shop.findByIdAndDelete(userId);
        if (deletedDoc) {
          deletedType = 'Shop';
          deletedName = deletedDoc.name;
          const menuResult = await FoodItem.deleteMany({ restaurantId: deletedDoc._id });
          console.log(`Cascade deleted ${menuResult.deletedCount} items for shop ${deletedDoc.name} (${deletedDoc._id})`);
        }
      }

      // 2. Try deleting Rider
      if (!deletedDoc) {
        deletedDoc = await Rider.findByIdAndDelete(userId);
        if (deletedDoc) {
          deletedType = 'Delivery Partner';
          deletedName = deletedDoc.name;
        }
      }

      // 3. Try deleting Customer
      if (!deletedDoc) {
        deletedDoc = await Customer.findByIdAndDelete(userId);
        if (deletedDoc) {
          deletedType = 'Customer';
          deletedName = deletedDoc.name;
          await Address.deleteMany({ userId: String(deletedDoc._id) });
        }
      }

      // 4. Try deleting Employee (subadmin)
      if (!deletedDoc) {
        deletedDoc = await Employee.findByIdAndDelete(userId);
        if (deletedDoc) {
          deletedType = 'Sub-admin';
          deletedName = deletedDoc.name;
        }
      }

      if (!deletedDoc) {
        return res.status(404).json({ message: 'Account not found' });
      }

      return res.json({
        message: `${deletedType} "${deletedName}" and all associated data deleted successfully`,
        userId,
      });
    } catch (error) {
      console.error('Delete account failed:', error);
      return res.status(500).json({ message: 'Unable to delete account' });
    }
  });

  // Reset password for any Shop, Restaurant, Rider, Customer, or Sub-Admin account
  // Default password format: Tomato<DDMMYYYY> where <DDMMYYYY> is the user's DOB (or custom password provided by admin)
  router.post('/users/:userId/reset-password', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '').trim();
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Locate user across Shop, Restaurant, Rider, Customer, Employee
      let targetDoc: any =
        (await Shop.findById(userId)) ||
        (await Restaurant.findById(userId)) ||
        (await Rider.findById(userId)) ||
        (await Customer.findById(userId)) ||
        (await Employee.findById(userId));

      if (!targetDoc) {
        return res.status(404).json({ message: 'User account not found' });
      }

      if (targetDoc.role === 'admin' && currentUser?.role !== 'admin') {
        return res.status(403).json({
          message: 'Access denied. Sub-admins cannot reset administrator passwords.',
        });
      }
      if (targetDoc.role === 'subadmin' && currentUser?.role !== 'admin') {
        return res.status(403).json({
          message: 'Access denied. Only the platform administrator can reset sub-admin passwords.',
        });
      }

      const providedDob = typeof req.body?.dob === 'string' ? req.body.dob.trim() : '';
      if (providedDob) {
        targetDoc.dob = providedDob;
      }

      const effectiveDob = String(targetDoc.dob || '').trim();

      // Convert YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY into DDMMYYYY
      const formatDobToDDMMYYYY = (rawDob: string): string => {
        if (!rawDob) return '';
        const isoMatch = rawDob.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
        if (isoMatch) {
          return `${isoMatch[3]}${isoMatch[2]}${isoMatch[1]}`;
        }
        const dmyMatch = rawDob.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
        if (dmyMatch) {
          return `${dmyMatch[1]}${dmyMatch[2]}${dmyMatch[3]}`;
        }
        const digitsOnly = rawDob.replace(/\D/g, '');
        if (digitsOnly.length === 8) return digitsOnly;
        return '';
      };

      const ddmmyyyy = formatDobToDDMMYYYY(effectiveDob);
      const customPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword.trim() : '';

      const finalPassword = customPassword || (ddmmyyyy ? `Tomato${ddmmyyyy}` : '');
      if (!finalPassword) {
        return res.status(400).json({
          message: 'Please select the user\'s DOB to generate "Tomato<DDMMYYYY>" or enter a custom password.',
        });
      }

      if (finalPassword.length < 6) {
        return res.status(400).json({
          message: 'Password must be at least 6 characters long.',
        });
      }

      targetDoc.passwordHash = await hashPassword(finalPassword);
      targetDoc.resetPasswordTokenHash = undefined;
      targetDoc.resetPasswordExpiresAt = undefined;
      await targetDoc.save();

      await Notification.create({
        userId: String(targetDoc._id),
        role: targetDoc.role,
        title: 'Password Reset by Admin',
        message: 'Your account password has been reset by the platform administrator.',
        type: 'service',
      });

      return res.json({
        message: `Password for "${targetDoc.name}" has been reset successfully to "${finalPassword}".`,
        resetPassword: finalPassword,
        user: userResponse(targetDoc),
      });
    } catch (error) {
      console.error('Admin reset password failed:', error);
      return res.status(500).json({ message: 'Unable to reset user password' });
    }
  });

  // =========================================================================
  // SUB-ADMIN MANAGEMENT & ROLE-BASED ACCESS CONTROL (RBAC)
  // =========================================================================

  // List all sub-admins with their permissions
  router.get(
    '/subadmins',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const { search } = req.query;
        const filter: Record<string, any> = { role: 'subadmin' };

        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { adminRoleTitle: { $regex: escaped, $options: 'i' } },
            { subadminId: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
          }
          filter.$or = orConditions;
        }

        const subadmins = await Employee.find(filter).sort({ createdAt: -1 });
        return res.json({
          subadmins: subadmins.map((u) => userResponse(u)),
          total: subadmins.length,
        });
      } catch (error) {
        console.error('Fetch sub-admins failed:', error);
        return res.status(500).json({ message: 'Unable to fetch sub-admins' });
      }
    },
  );

  // Create new sub-admin and assign operational role + permissions
  router.post(
    '/subadmins',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const creator = (req as AuthenticatedRequest).user;
        if (creator?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can create sub-admin accounts.',
          });
        }

        const { name, email, phone, password, adminRoleTitle, permissions } =
          req.body;

        if (!name || (!email && !phone) || !password) {
          return res
            .status(400)
            .json({
              message: 'Name, email or phone, and password are required',
            });
        }

        if (typeof password !== 'string' || password.length < 8) {
          return res
            .status(400)
            .json({ message: 'Password must be at least 8 characters long' });
        }

        const cleanEmail =
          typeof email === 'string' ? email.trim().toLowerCase() : '';
        const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

        const existing = await Employee.findOne({
          $or: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(cleanPhone ? [{ phone: cleanPhone }] : []),
          ],
        });

        if (existing) {
          return res
            .status(409)
            .json({
              message: 'An account with that email or phone already exists',
            });
        }

        const allowedPermissions = [
          'dashboard_view',
          'orders_manage',
          'shops_manage',
          'restaurants_manage',
          'riders_manage',
          'customers_manage',
          'subadmins_manage',
        ];

        const safePermissions = Array.isArray(permissions)
          ? permissions.filter(
              (p: unknown) =>
                typeof p === 'string' &&
                (allowedPermissions.includes(p) || p === '*'),
            )
          : ['orders_manage'];

        const subAdminData: Record<string, any> = {
          name: name.trim(),
          subadminId: await generateSubAdminId(),
          passwordHash: await hashPassword(password),
          role: 'subadmin',
          isApproved: true,
          isBlocked: false,
          adminRoleTitle:
            adminRoleTitle && typeof adminRoleTitle === 'string'
              ? adminRoleTitle.trim()
              : 'Operations Sub-Admin',
          permissions: safePermissions,
          createdBy: creator?.name || creator?.email || 'Platform Admin',
        };
        if (cleanEmail) subAdminData.email = cleanEmail;
        if (cleanPhone) subAdminData.phone = cleanPhone;

        const subAdmin = await Employee.create(subAdminData);

        await Notification.create({
          userId: String(subAdmin._id),
          role: 'subadmin',
          title: 'Welcome to Tomato Administration',
          message: `Your sub-admin account (${subAdmin.adminRoleTitle}) has been created with assigned permissions.`,
          type: 'system',
        });

        return res.status(201).json({
          message: `Sub-admin "${subAdmin.name}" created successfully with assigned role`,
          subadmin: userResponse(subAdmin),
        });
      } catch (error) {
        console.error('Create sub-admin failed:', error);
        return res.status(500).json({ message: 'Unable to create sub-admin' });
      }
    },
  );

  // Update sub-admin permissions and role title
  router.put(
    '/subadmins/:id/permissions',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const currentUser = (req as AuthenticatedRequest).user;
        if (currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can update sub-admin roles and permissions.',
          });
        }

        const subAdminId = req.params.id;
        if (!mongoose.isValidObjectId(subAdminId)) {
          return res.status(400).json({ message: 'Invalid sub-admin ID' });
        }

        const targetUser = await Employee.findById(subAdminId);
        if (!targetUser) {
          return res.status(404).json({ message: 'Sub-admin not found' });
        }

        if (targetUser.role === 'admin') {
          return res.status(403).json({
            message: 'Access denied. Administrator permissions and roles cannot be modified.',
          });
        }

        if (targetUser.role !== 'subadmin') {
          return res
            .status(400)
            .json({
              message: 'Cannot modify permissions for non-subadmin users',
            });
        }

        const { permissions, adminRoleTitle } = req.body;
        const allowedPermissions = [
          'dashboard_view',
          'orders_manage',
          'shops_manage',
          'restaurants_manage',
          'riders_manage',
          'customers_manage',
          'subadmins_manage',
        ];

        const updates: Record<string, unknown> = {};
        if (Array.isArray(permissions)) {
          updates.permissions = permissions.filter(
            (p: unknown) =>
              typeof p === 'string' &&
              (allowedPermissions.includes(p) || p === '*'),
          );
        }
        if (typeof adminRoleTitle === 'string' && adminRoleTitle.trim()) {
          updates.adminRoleTitle = adminRoleTitle.trim();
        }

        const updated = await Employee.findByIdAndUpdate(
          subAdminId,
          { $set: updates },
          { returnDocument: 'after' },
        );

        return res.json({
          message: 'Sub-admin permissions updated successfully',
          subadmin: userResponse(updated!),
        });
      } catch (error) {
        console.error('Update sub-admin permissions failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to update sub-admin permissions' });
      }
    },
  );

  // Toggle sub-admin block/unblock status
  router.put(
    '/subadmins/:id/status',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const currentUser = (req as AuthenticatedRequest).user;
        if (currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can change sub-admin status.',
          });
        }

        const subAdminId = req.params.id;
        if (!mongoose.isValidObjectId(subAdminId)) {
          return res.status(400).json({ message: 'Invalid sub-admin ID' });
        }

        if (currentUser?.userId === subAdminId) {
          return res
            .status(400)
            .json({
              message: 'You cannot block your own administrator account',
            });
        }

        const target = await Employee.findById(subAdminId);
        if (!target)
          return res.status(404).json({ message: 'Sub-admin not found' });
        if (target.role !== 'subadmin') {
          return res
            .status(403)
            .json({
              message: 'Access denied. Cannot modify status of administrator accounts.',
            });
        }

        const nextBlocked =
          req.body.isBlocked !== undefined
            ? Boolean(req.body.isBlocked)
            : !target.isBlocked;
        target.isBlocked = nextBlocked;
        await target.save();

        return res.json({
          message: `Sub-admin account ${nextBlocked ? 'blocked' : 'unblocked'} successfully`,
          subadmin: userResponse(target),
        });
      } catch (error) {
        console.error('Toggle sub-admin status failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to change sub-admin status' });
      }
    },
  );

  // Delete sub-admin permanently
  router.delete(
    '/subadmins/:id',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const currentUser = (req as AuthenticatedRequest).user;
        if (currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can delete sub-admin accounts.',
          });
        }

        const subAdminId = req.params.id;
        if (!mongoose.isValidObjectId(subAdminId)) {
          return res.status(400).json({ message: 'Invalid sub-admin ID' });
        }

        if (currentUser?.userId === subAdminId) {
          return res
            .status(400)
            .json({
              message: 'You cannot delete your own administrator account',
            });
        }

        const target = await Employee.findById(subAdminId);
        if (!target)
          return res.status(404).json({ message: 'Sub-admin not found' });
        if (target.role !== 'subadmin') {
          return res
            .status(403)
            .json({ message: 'Access denied. Administrator accounts cannot be deleted.' });
        }

        await Employee.findByIdAndDelete(subAdminId);

        return res.json({
          message: `Sub-admin "${target.name}" deleted successfully`,
          deletedId: subAdminId,
        });
      } catch (error) {
        console.error('Delete sub-admin failed:', error);
        return res.status(500).json({ message: 'Unable to delete sub-admin' });
      }
    },
  );


export default router;

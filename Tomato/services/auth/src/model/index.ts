import User, { IUser, USER_ROLES, UserRole } from './User.js';
import Customer, { ICustomer } from './Customer.js';
import Restaurant, { IRestaurant } from './Restaurant.js';
import Rider, { IRider } from './Rider.js';
import Order, { IOrder, OrderStatus } from './Order.js';
import FoodItem, { IFoodItem } from './FoodItem.js';
import Notification, { INotification } from './Notification.js';
import Address, { IAddress } from './Address.js';
import WalletCreditTrack, { IWalletCreditTrack } from './WalletCreditTrack.js';

export {
  User,
  IUser,
  USER_ROLES,
  UserRole,
  Customer,
  ICustomer,
  Restaurant,
  IRestaurant,
  Rider,
  IRider,
  Order,
  IOrder,
  OrderStatus,
  FoodItem,
  IFoodItem,
  Notification,
  INotification,
  Address,
  IAddress,
  WalletCreditTrack,
  IWalletCreditTrack,
};

export default {
  User,
  Customer,
  Restaurant,
  Rider,
  Order,
  FoodItem,
  Notification,
  Address,
  WalletCreditTrack,
};

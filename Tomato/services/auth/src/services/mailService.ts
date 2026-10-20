import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { getMailConfig } from '../config/mailConfig.js';

export interface OrderEmailItem {
  name: string;
  quantity: number;
  price: number;
  totalPrice: number;
}

export interface OrderPlacedMailParams {
  customerEmail: string;
  customerName: string;
  orderNumber: string;
  billNumber?: string | undefined;
  storeName: string;
  storeAddress?: string | undefined;
  isShopOrder?: boolean | undefined;
  items: OrderEmailItem[];
  subtotal: number;
  tax: number;
  deliveryFee: number;
  discountAmount?: number | undefined;
  couponCodes?: string[] | undefined;
  totalAmount: number;
  paymentMethod: string;
  paymentStatus: string;
  deliveryAddress?: {
    label?: string | undefined;
    line1?: string | undefined;
    line2?: string | undefined;
    city?: string | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
    digipin?: string | undefined;
    phone?: string | undefined;
  } | undefined;
  orderDate?: Date | undefined;
}

export interface OrderDeliveredMailParams {
  customerEmail: string;
  customerName: string;
  orderNumber: string;
  billNumber?: string | undefined;
  storeName: string;
  storeAddress?: string | undefined;
  isShopOrder?: boolean | undefined;
  riderName?: string | undefined;
  riderPhone?: string | undefined;
  items: OrderEmailItem[];
  totalAmount: number;
  paymentMethod: string;
  deliveryAddress?: {
    label?: string | undefined;
    line1?: string | undefined;
    line2?: string | undefined;
    city?: string | undefined;
    state?: string | undefined;
    postalCode?: string | undefined;
    digipin?: string | undefined;
    phone?: string | undefined;
  } | undefined;
  deliveredAt?: Date | undefined;
}

export interface PasswordResetMailParams {
  customerEmail: string;
  customerName: string;
  resetToken: string;
  resetUrl?: string | undefined;
  expiresInMinutes?: number | undefined;
}

export interface PasswordChangedMailParams {
  customerEmail: string;
  customerName: string;
  changedAt?: Date | undefined;
}

export interface MailSendResult {
  success: boolean;
  messageId?: string;
  simulated?: boolean;
  error?: string;
}

class MailService {
  private transporter: Transporter | null = null;

  /**
   * Initialize or retrieve the active Nodemailer SMTP transport instance
   */
  private getTransporter(): Transporter | null {
    const config = getMailConfig();
    if (!config.enabled) {
      return null;
    }

    if (!this.transporter) {
      try {
        if (config.service) {
          this.transporter = nodemailer.createTransport({
            service: config.service,
            auth: {
              user: config.user,
              pass: config.pass,
            },
          });
        } else {
          this.transporter = nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.secure,
            auth: {
              user: config.user,
              pass: config.pass,
            },
          });
        }
      } catch (err) {
        console.error('[Mail Service] Error initializing SMTP transport:', err);
        return null;
      }
    }

    return this.transporter;
  }

  /**
   * Generate a responsive, modern HTML email template for order confirmation
   */
  private generateOrderEmailHtml(data: OrderPlacedMailParams): string {
    const formattedDate = (data.orderDate || new Date()).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const storeTypeLabel = data.isShopOrder ? 'Grocery Shop' : 'Restaurant';

    const itemsRowsHtml = data.items
      .map(
        (item) => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 12px 8px; font-size: 14px; color: #1e293b; font-weight: 500;">
            ${escapeHtml(item.name)}
          </td>
          <td style="padding: 12px 8px; font-size: 14px; color: #64748b; text-align: center;">
            ×${item.quantity}
          </td>
          <td style="padding: 12px 8px; font-size: 14px; color: #1e293b; text-align: right; font-weight: 600;">
            ₹${item.totalPrice.toFixed(2)}
          </td>
        </tr>`,
      )
      .join('');

    const addressParts = [
      data.deliveryAddress?.line1,
      data.deliveryAddress?.line2,
      data.deliveryAddress?.city,
      data.deliveryAddress?.state,
      data.deliveryAddress?.postalCode ? `PIN: ${data.deliveryAddress.postalCode}` : '',
      data.deliveryAddress?.digipin ? `DigiPin: ${data.deliveryAddress.digipin}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    const discountRowHtml =
      data.discountAmount && data.discountAmount > 0
        ? `<tr>
            <td style="padding: 6px 0; font-size: 14px; color: #16a34a;">Coupon Discount ${data.couponCodes?.length ? `(${data.couponCodes.join(', ')})` : ''}</td>
            <td style="padding: 6px 0; font-size: 14px; color: #16a34a; text-align: right; font-weight: 600;">-₹${data.discountAmount.toFixed(2)}</td>
          </tr>`
        : '';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Confirmation #${escapeHtml(data.orderNumber)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px; }
    .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #e23744 0%, #b91c1c 100%); color: #ffffff; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 8px 0 0 0; font-size: 15px; opacity: 0.95; }
    .content { padding: 24px; }
    .order-badge-card { background: #fef2f2; border: 1px dashed #fca5a5; border-radius: 12px; padding: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
    .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 8px; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .summary-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .total-row { border-top: 2px solid #e2e8f0; font-size: 16px; font-weight: 800; color: #0f172a; }
    .footer { text-align: center; padding: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div style="font-size: 38px; margin-bottom: 6px;">🍅</div>
      <h1>Order Confirmed!</h1>
      <p>Thank you for choosing Tomato, ${escapeHtml(data.customerName)}.</p>
    </div>

    <div class="content">
      <div class="order-badge-card">
        <div>
          <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #b91c1c;">Order Number</div>
          <div style="font-size: 18px; font-weight: 800; color: #991b1b;">#${escapeHtml(data.orderNumber)}</div>
          ${data.billNumber ? `<div style="font-size: 12px; color: #64748b;">Bill: ${escapeHtml(data.billNumber)}</div>` : ''}
        </div>
        <div style="text-align: right;">
          <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b;">Placed On</div>
          <div style="font-size: 13px; font-weight: 600; color: #334155;">${formattedDate}</div>
          <div style="display: inline-block; margin-top: 4px; background: #22c55e; color: #ffffff; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700;">
            ${escapeHtml(data.paymentStatus.toUpperCase())}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${storeTypeLabel}</div>
        <div style="font-size: 16px; font-weight: 700; color: #0f172a;">${escapeHtml(data.storeName)}</div>
        ${data.storeAddress ? `<div style="font-size: 13px; color: #64748b; margin-top: 4px;">📍 ${escapeHtml(data.storeAddress)}</div>` : ''}
      </div>

      <div class="card" style="padding: 12px 16px;">
        <div class="card-title">Order Items (${data.items.length})</div>
        <table class="items-table">
          <thead>
            <tr style="border-bottom: 2px solid #e2e8f0; font-size: 12px; color: #64748b; text-transform: uppercase;">
              <th style="padding: 8px; text-align: left;">Item</th>
              <th style="padding: 8px; text-align: center;">Qty</th>
              <th style="padding: 8px; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRowsHtml}
          </tbody>
        </table>

        <table class="summary-table">
          <tr>
            <td style="padding: 4px 0; font-size: 14px; color: #64748b;">Item Total (Subtotal)</td>
            <td style="padding: 4px 0; font-size: 14px; color: #334155; text-align: right; font-weight: 600;">₹${data.subtotal.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; font-size: 14px; color: #64748b;">Taxes & Restaurant Charges (5%)</td>
            <td style="padding: 4px 0; font-size: 14px; color: #334155; text-align: right; font-weight: 600;">₹${data.tax.toFixed(2)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; font-size: 14px; color: #64748b;">Delivery Partner Fee</td>
            <td style="padding: 4px 0; font-size: 14px; color: #334155; text-align: right; font-weight: 600;">₹${data.deliveryFee.toFixed(2)}</td>
          </tr>
          ${discountRowHtml}
          <tr class="total-row">
            <td style="padding: 12px 0 4px 0;">Total Paid</td>
            <td style="padding: 12px 0 4px 0; text-align: right; color: #e23744; font-size: 20px;">₹${data.totalAmount.toFixed(2)}</td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 2px 0; font-size: 12px; color: #94a3b8; text-align: right;">
              Payment Method: <strong>${escapeHtml(data.paymentMethod.toUpperCase())}</strong>
            </td>
          </tr>
        </table>
      </div>

      <div class="card">
        <div class="card-title">Delivery Location</div>
        <div style="font-size: 14px; color: #1e293b; line-height: 1.5;">
          ${data.deliveryAddress?.label ? `<strong>${escapeHtml(data.deliveryAddress.label)}:</strong> ` : ''}
          ${escapeHtml(addressParts || 'Customer Registered Address')}
        </div>
        ${data.deliveryAddress?.phone ? `<div style="font-size: 13px; color: #64748b; margin-top: 6px;">📞 Contact: ${escapeHtml(data.deliveryAddress.phone)}</div>` : ''}
      </div>

      <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 14px 18px; margin-bottom: 20px; display: flex; align-items: center;">
        <span style="font-size: 24px; margin-right: 12px;">⚡</span>
        <div>
          <div style="font-size: 13px; font-weight: 700; color: #1e40af;">Estimated Delivery Time</div>
          <div style="font-size: 13px; color: #1d4ed8;">30 - 45 Minutes. Your delivery partner will contact you upon arrival.</div>
        </div>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0 0 8px 0;">Need help with your order? Open the Tomato App or email us at support@tomato.com</p>
      <p style="margin: 0;">&copy; ${new Date().getFullYear()} Tomato Food & Grocery Delivery. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;
  }

  /**
   * Generate a responsive, celebration HTML email template for order delivered
   */
  private generateDeliveredEmailHtml(data: OrderDeliveredMailParams): string {
    const formattedDate = (data.deliveredAt || new Date()).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const storeTypeLabel = data.isShopOrder ? 'Grocery Shop' : 'Restaurant';

    const itemsRowsHtml = data.items
      .map(
        (item) => `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 8px; font-size: 14px; color: #1e293b; font-weight: 500;">
            ${escapeHtml(item.name)}
          </td>
          <td style="padding: 10px 8px; font-size: 14px; color: #64748b; text-align: center;">
            ×${item.quantity}
          </td>
          <td style="padding: 10px 8px; font-size: 14px; color: #1e293b; text-align: right; font-weight: 600;">
            ₹${item.totalPrice.toFixed(2)}
          </td>
        </tr>`,
      )
      .join('');

    const addressParts = [
      data.deliveryAddress?.line1,
      data.deliveryAddress?.line2,
      data.deliveryAddress?.city,
      data.deliveryAddress?.state,
      data.deliveryAddress?.postalCode ? `PIN: ${data.deliveryAddress.postalCode}` : '',
      data.deliveryAddress?.digipin ? `DigiPin: ${data.deliveryAddress.digipin}` : '',
    ]
      .filter(Boolean)
      .join(', ');

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Order Delivered! #${escapeHtml(data.orderNumber)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px; }
    .email-container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 8px 0 0 0; font-size: 15px; opacity: 0.95; }
    .content { padding: 24px; }
    .delivered-card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px; margin-bottom: 24px; text-align: center; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
    .card-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; margin-bottom: 8px; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .feedback-box { background: linear-gradient(135deg, #fef2f2 0%, #fff1f2 100%); border: 1px solid #fecdd3; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 20px; }
    .footer { text-align: center; padding: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div style="font-size: 42px; margin-bottom: 8px;">🎉</div>
      <h1>Order Delivered!</h1>
      <p>Enjoy your meal, ${escapeHtml(data.customerName)}!</p>
    </div>

    <div class="content">
      <div class="delivered-card">
        <div style="font-size: 14px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.5px;">
          ✓ Delivery Complete
        </div>
        <div style="font-size: 22px; font-weight: 800; color: #14532d; margin: 4px 0;">
          Order #${escapeHtml(data.orderNumber)}
        </div>
        <div style="font-size: 13px; color: #15803d;">
          Delivered on ${formattedDate}
        </div>
        ${data.riderName ? `
          <div style="margin-top: 10px; font-size: 13px; color: #334155; font-weight: 600;">
            🚴 Delivered by: <span>${escapeHtml(data.riderName)}</span>
            ${data.riderPhone ? `<span style="color: #64748b; font-weight: normal;"> (${escapeHtml(data.riderPhone)})</span>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="card">
        <div class="card-title">${storeTypeLabel}</div>
        <div style="font-size: 16px; font-weight: 700; color: #0f172a;">${escapeHtml(data.storeName)}</div>
        ${data.storeAddress ? `<div style="font-size: 13px; color: #64748b; margin-top: 4px;">📍 ${escapeHtml(data.storeAddress)}</div>` : ''}
      </div>

      <div class="card">
        <div class="card-title">Delivered To</div>
        <div style="font-size: 14px; color: #1e293b; line-height: 1.5;">
          ${data.deliveryAddress?.label ? `<strong>${escapeHtml(data.deliveryAddress.label)}:</strong> ` : ''}
          ${escapeHtml(addressParts || 'Customer Registered Address')}
        </div>
      </div>

      <div class="card" style="padding: 12px 16px;">
        <div class="card-title">Delivered Items (${data.items.length})</div>
        <table class="items-table">
          <thead>
            <tr style="border-bottom: 2px solid #e2e8f0; font-size: 12px; color: #64748b; text-transform: uppercase;">
              <th style="padding: 8px; text-align: left;">Item</th>
              <th style="padding: 8px; text-align: center;">Qty</th>
              <th style="padding: 8px; text-align: right;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRowsHtml}
          </tbody>
        </table>
        <div style="border-top: 2px solid #e2e8f0; padding-top: 10px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 14px; color: #64748b;">Total Paid (${escapeHtml(data.paymentMethod.toUpperCase())})</span>
          <span style="font-size: 18px; font-weight: 800; color: #0f172a;">₹${data.totalAmount.toFixed(2)}</span>
        </div>
      </div>

      <!-- Experience & Feedback Call to Action -->
      <div class="feedback-box">
        <div style="font-size: 26px; margin-bottom: 6px;">⭐⭐⭐⭐⭐</div>
        <div style="font-size: 16px; font-weight: 700; color: #881337; margin-bottom: 4px;">How was your food and delivery?</div>
        <p style="font-size: 13px; color: #9f1239; margin: 0 0 14px 0; line-height: 1.5;">
          Your feedback helps ${escapeHtml(data.storeName)} and our delivery partner improve!
        </p>
        <div style="display: inline-block; background: #e23744; color: #ffffff; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 700; text-decoration: none;">
          Rate Your Meal on Tomato
        </div>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0 0 8px 0;">Have feedback or an issue with your delivery? We're available 24/7 at support@tomato.com</p>
      <p style="margin: 0;">&copy; ${new Date().getFullYear()} Tomato Food & Grocery Delivery. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;
  }

  /**
   * Send order placed confirmation email to customer
   */
  public async sendOrderPlacedMail(data: OrderPlacedMailParams): Promise<MailSendResult> {
    if (!data.customerEmail || !data.customerEmail.includes('@')) {
      return {
        success: false,
        error: 'Invalid or missing customer email address',
      };
    }

    const config = getMailConfig();
    const transporter = this.getTransporter();

    const subject = `🍕 Order Confirmed! #${data.orderNumber} from ${data.storeName} [Tomato]`;
    const html = this.generateOrderEmailHtml(data);
    const text = `Order Confirmed! #${data.orderNumber}\n\nHi ${data.customerName},\nYour order from ${data.storeName} has been confirmed.\nTotal: ₹${data.totalAmount.toFixed(2)} via ${data.paymentMethod.toUpperCase()}.\nEstimated Delivery: 30-45 minutes.\n\nThank you for choosing Tomato!`;

    if (!transporter || !config.enabled) {
      console.log(
        `[Mail Service] SMTP credentials not set or disabled in .env. Order confirmation email simulated for ${data.customerEmail} (Order #${data.orderNumber}, Total: ₹${data.totalAmount}).`,
      );
      return {
        success: true,
        simulated: true,
      };
    }

    try {
      const info = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: data.customerEmail,
        subject,
        text,
        html,
      });

      console.log(`[Mail Service] Order confirmation email sent successfully to ${data.customerEmail}. Message ID: ${info.messageId}`);
      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (err: any) {
      console.error(`[Mail Service] Failed to send email to ${data.customerEmail}:`, err.message);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Send order delivered email to customer
   */
  public async sendOrderDeliveredMail(data: OrderDeliveredMailParams): Promise<MailSendResult> {
    if (!data.customerEmail || !data.customerEmail.includes('@')) {
      return {
        success: false,
        error: 'Invalid or missing customer email address',
      };
    }

    const config = getMailConfig();
    const transporter = this.getTransporter();

    const subject = `🎉 Order Delivered! #${data.orderNumber} from ${data.storeName} [Tomato]`;
    const html = this.generateDeliveredEmailHtml(data);
    const text = `Order Delivered! #${data.orderNumber}\n\nHi ${data.customerName},\nYour order from ${data.storeName} has been delivered successfully.\nDelivered by: ${data.riderName || 'Tomato Delivery Partner'}.\nTotal: ₹${data.totalAmount.toFixed(2)}.\n\nEnjoy your meal!\n- The Tomato Team`;

    if (!transporter || !config.enabled) {
      console.log(
        `[Mail Service] SMTP credentials not set or disabled in .env. Order delivered email simulated for ${data.customerEmail} (Order #${data.orderNumber}, Delivered at ${data.deliveredAt || new Date()}).`,
      );
      return {
        success: true,
        simulated: true,
      };
    }

    try {
      const info = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: data.customerEmail,
        subject,
        text,
        html,
      });

      console.log(`[Mail Service] Order delivered email sent successfully to ${data.customerEmail}. Message ID: ${info.messageId}`);
      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (err: any) {
      console.error(`[Mail Service] Failed to send delivered email to ${data.customerEmail}:`, err.message);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Generate a responsive, security-focused HTML email for 6-digit password reset verification code
   */
  private generatePasswordResetHtml(data: PasswordResetMailParams): string {
    const expireMins = data.expiresInMinutes || 10;
    const buttonHtml = data.resetUrl
      ? `
      <div style="text-align: center; margin: 24px 0 16px 0;">
        <a href="${escapeHtml(data.resetUrl)}" style="background: #e23744; color: #ffffff; padding: 12px 28px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px rgba(226,55,68,0.25);">
          Direct Reset Link
        </a>
      </div>`
      : '';

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your 6-Digit Password Reset Code</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px; }
    .email-container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #e23744 0%, #991b1b 100%); color: #ffffff; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0 0; font-size: 14px; opacity: 0.9; }
    .content { padding: 28px 24px; color: #334155; line-height: 1.6; }
    .otp-card { background: #fef2f2; border: 2px dashed #f87171; border-radius: 14px; padding: 20px; text-align: center; margin: 22px 0; }
    .otp-number { font-family: 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; font-size: 40px; font-weight: 800; letter-spacing: 10px; color: #dc2626; margin: 4px 0; }
    .warning-box { background: #fffbeb; border: 1px solid #fef3c7; border-radius: 10px; padding: 14px 16px; font-size: 13px; color: #92400e; margin-top: 24px; }
    .footer { text-align: center; padding: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div style="font-size: 38px; margin-bottom: 6px;">🔐</div>
      <h1>Password Reset Code</h1>
      <p>Tomato Account Security</p>
    </div>

    <div class="content">
      <p style="margin-top: 0; font-size: 15px;">Hi <strong>${escapeHtml(data.customerName)}</strong>,</p>
      <p style="font-size: 14px;">
        We received a request to reset the password for your Tomato account. Enter the <strong>6-digit verification code</strong> below in the password reset box to continue:
      </p>

      <div class="otp-card">
        <div style="font-size: 12px; font-weight: 700; color: #991b1b; text-transform: uppercase; letter-spacing: 1px;">
          Verification Code
        </div>
        <div class="otp-number">${escapeHtml(data.resetToken)}</div>
        <div style="font-size: 13px; font-weight: 600; color: #b91c1c; margin-top: 4px;">
          ⏳ Valid for ${expireMins} minutes only
        </div>
      </div>

      ${buttonHtml}

      <div class="warning-box">
        <strong>Security Notice:</strong> Never share this 6-digit code with anyone. Tomato employees will never ask for your verification code. If you did not request this, please ignore this email; your account remains secure.
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0 0 6px 0;">Need help? Contact support at support@tomato.com</p>
      <p style="margin: 0;">&copy; ${new Date().getFullYear()} Tomato Food & Grocery Delivery. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;
  }

  /**
   * Generate an alert HTML email when password has successfully changed
   */
  private generatePasswordChangedHtml(data: PasswordChangedMailParams): string {
    const formattedDate = (data.changedAt || new Date()).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Tomato Password Was Changed</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px; }
    .email-container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #16a34a 0%, #15803d 100%); color: #ffffff; padding: 32px 24px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px; }
    .header p { margin: 6px 0 0 0; font-size: 14px; opacity: 0.9; }
    .content { padding: 28px 24px; color: #334155; line-height: 1.6; }
    .alert-card { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px; margin: 20px 0; }
    .warning-box { background: #fef2f2; border: 1px solid #fecdd3; border-radius: 10px; padding: 14px 16px; font-size: 13px; color: #991b1b; margin-top: 24px; }
    .footer { text-align: center; padding: 24px; font-size: 12px; color: #94a3b8; border-top: 1px solid #f1f5f9; background: #fafafa; }
  </style>
</head>
<body>
  <div class="email-container">
    <div class="header">
      <div style="font-size: 38px; margin-bottom: 6px;">🛡️</div>
      <h1>Password Changed Successfully</h1>
      <p>Tomato Account Security</p>
    </div>

    <div class="content">
      <p style="margin-top: 0; font-size: 15px;">Hi <strong>${escapeHtml(data.customerName)}</strong>,</p>
      <p style="font-size: 14px;">
        This email confirms that the password for your Tomato account was successfully changed on <strong>${formattedDate}</strong>.
      </p>

      <div class="alert-card">
        <div style="font-size: 14px; font-weight: 700; color: #166534; margin-bottom: 4px;">✓ Security Protection Active</div>
        <div style="font-size: 13px; color: #15803d;">
          All previous active sessions on other browsers and devices have been logged out automatically for your protection.
        </div>
      </div>

      <div class="warning-box">
        <strong>⚠️ Did not make this change?</strong>
        <p style="margin: 4px 0 0 0;">If you did not perform this password change, someone may have unauthorized access to your account. Please contact our support team immediately at <strong>support@tomato.com</strong>.</p>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0 0 6px 0;">This is an automated security notification regarding your Tomato account.</p>
      <p style="margin: 0;">&copy; ${new Date().getFullYear()} Tomato Food & Grocery Delivery. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
`;
  }

  /**
   * Send secure password reset email with token and direct link
   */
  public async sendPasswordResetMail(data: PasswordResetMailParams): Promise<MailSendResult> {
    if (!data.customerEmail || !data.customerEmail.includes('@')) {
      return {
        success: false,
        error: 'Invalid or missing customer email address',
      };
    }

    const config = getMailConfig();
    const transporter = this.getTransporter();

    const subject = `🔐 ${data.resetToken} is your Tomato password reset code`;
    const html = this.generatePasswordResetHtml(data);
    const text = `Password Reset Verification Code: ${data.resetToken}\n\nHi ${data.customerName},\nYour 6-digit verification code to reset your Tomato account password is:\n${data.resetToken}\n\nThis verification code is valid for ${data.expiresInMinutes || 10} minutes only.\n${data.resetUrl ? `You can also reset via this link: ${data.resetUrl}\n` : ''}\nIf you did not make this request, please ignore this email.`;

    if (!transporter || !config.enabled) {
      console.log(
        `[Mail Service] SMTP credentials not set or disabled in .env. Password reset email simulated for ${data.customerEmail} (6-Digit Code: ${data.resetToken}, Expires in ${data.expiresInMinutes || 10}m).`,
      );
      return {
        success: true,
        simulated: true,
      };
    }

    try {
      const info = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: data.customerEmail,
        subject,
        text,
        html,
      });

      console.log(`[Mail Service] Password reset email sent successfully to ${data.customerEmail}. Message ID: ${info.messageId}`);
      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (err: any) {
      console.error(`[Mail Service] Failed to send password reset email to ${data.customerEmail}:`, err.message);
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Send notification email when password has been successfully reset
   */
  public async sendPasswordChangedMail(data: PasswordChangedMailParams): Promise<MailSendResult> {
    if (!data.customerEmail || !data.customerEmail.includes('@')) {
      return {
        success: false,
        error: 'Invalid or missing customer email address',
      };
    }

    const config = getMailConfig();
    const transporter = this.getTransporter();

    const subject = `🛡️ Your Tomato Password Was Changed`;
    const html = this.generatePasswordChangedHtml(data);
    const text = `Password Changed Successfully\n\nHi ${data.customerName},\nThis email confirms that your Tomato account password was changed on ${data.changedAt || new Date()}.\nAll active sessions on other devices have been logged out.\nIf you did not make this change, please contact support@tomato.com immediately.`;

    if (!transporter || !config.enabled) {
      console.log(
        `[Mail Service] SMTP credentials not set or disabled in .env. Password changed security alert email simulated for ${data.customerEmail}.`,
      );
      return {
        success: true,
        simulated: true,
      };
    }

    try {
      const info = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to: data.customerEmail,
        subject,
        text,
        html,
      });

      console.log(`[Mail Service] Password changed email sent successfully to ${data.customerEmail}. Message ID: ${info.messageId}`);
      return {
        success: true,
        messageId: info.messageId,
      };
    } catch (err: any) {
      console.error(`[Mail Service] Failed to send password changed email to ${data.customerEmail}:`, err.message);
      return {
        success: false,
        error: err.message,
      };
    }
  }
}

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export const mailService = new MailService();
export default mailService;

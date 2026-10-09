import axios from 'axios';

export interface ArattaiSendParams {
  phoneNumber: string;
  templateId?: string;
  params?: Record<string, string | number>;
  message?: string;
}

export interface ArattaiResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  raw?: unknown;
}

class ArattaiNotificationService {
  private get isEnabled(): boolean {
    return (
      process.env.ARATTAI_ENABLED === 'true' ||
      Boolean(process.env.ARATTAI_ACCESS_TOKEN && process.env.ARATTAI_COMPANY_ID)
    );
  }

  private get baseUrl(): string {
    return process.env.ARATTAI_BASE_URL || 'https://business.arattai.in';
  }

  private get accessToken(): string {
    return process.env.ARATTAI_ACCESS_TOKEN || '';
  }

  private get companyId(): string {
    return process.env.ARATTAI_COMPANY_ID || '';
  }

  /**
   * Formats Indian mobile number to 91XXXXXXXXXX as expected by Arattai API
   */
  public formatIndianPhoneNumber(rawPhone: string): string | null {
    if (!rawPhone) return null;
    const digits = String(rawPhone).replace(/\D/g, '');
    if (digits.length === 10) {
      return `91${digits}`;
    } else if (digits.length === 12 && digits.startsWith('91')) {
      return digits;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      return `91${digits.slice(1)}`;
    }
    return digits.length >= 10 ? digits : null;
  }

  /**
   * Dispatches transactional notification via Arattai Business Platform REST API
   */
  public async sendNotification(options: ArattaiSendParams): Promise<ArattaiResponse> {
    const formattedPhone = this.formatIndianPhoneNumber(options.phoneNumber);

    if (!formattedPhone) {
      console.warn(`[Arattai Notification] Skipped: Invalid Indian mobile number "${options.phoneNumber}".`);
      return { success: false, error: 'Invalid Indian mobile phone number' };
    }

    if (!this.isEnabled || !this.accessToken || !this.companyId) {
      console.log(
        `[Arattai Notification (Mock/Dev)] Dispatch to Indian mobile ${formattedPhone}:`,
        {
          templateId: options.templateId,
          params: options.params,
          message: options.message,
          note: 'Provide ARATTAI_ACCESS_TOKEN and ARATTAI_COMPANY_ID in .env for live telecom dispatch.',
        }
      );
      return { success: true, messageId: `mock-arrattai-${Date.now()}` };
    }

    try {
      const payload: Record<string, unknown> = {
        phone_number: formattedPhone,
        template_id: options.templateId || process.env.ARATTAI_DEFAULT_TEMPLATE_ID || 'general_notification',
        params: options.params || {},
      };

      if (options.message) {
        payload.message = options.message;
      }

      const response = await axios.post(
        `${this.baseUrl}/api/v1/messages/transactional`,
        payload,
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Arattai-CompanyId': this.companyId,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      console.log(`[Arattai Notification] Delivered to ${formattedPhone}:`, response.data);
      return {
        success: true,
        messageId: response.data?.message_id || response.data?.id,
        raw: response.data,
      };
    } catch (error: any) {
      const errDetail = error.response?.data || error.message;
      console.error(`[Arattai Notification Error] Delivery to ${formattedPhone} failed:`, errDetail);
      return {
        success: false,
        error: typeof errDetail === 'object' ? JSON.stringify(errDetail) : String(errDetail),
      };
    }
  }

  /**
   * Complaint / Support Ticket Status Change Alert
   */
  public async notifyComplaintUpdate(args: {
    phoneNumber: string;
    userName: string;
    ticketId: string;
    status: string;
    adminComment?: string;
  }): Promise<ArattaiResponse> {
    const templateId = process.env.ARATTAI_COMPLAINT_TEMPLATE_ID || 'complaint_status_update';
    return this.sendNotification({
      phoneNumber: args.phoneNumber,
      templateId,
      params: {
        user_name: args.userName,
        ticket_id: args.ticketId,
        status: args.status,
        resolution_note: args.adminComment || 'Status updated by administrator',
      },
      message: `Hi ${args.userName}, your Tomato complaint ticket ${args.ticketId} has been updated to ${args.status}.${args.adminComment ? ` Note: ${args.adminComment}` : ''}`,
    });
  }

  /**
   * Support Ticket Creation Acknowledgment
   */
  public async notifyTicketCreated(args: {
    phoneNumber: string;
    userName: string;
    ticketId: string;
    category?: string;
  }): Promise<ArattaiResponse> {
    const templateId = process.env.ARATTAI_TICKET_TEMPLATE_ID || 'ticket_created_acknowledgment';
    return this.sendNotification({
      phoneNumber: args.phoneNumber,
      templateId,
      params: {
        user_name: args.userName,
        ticket_id: args.ticketId,
        category: args.category || 'Support',
      },
      message: `Hi ${args.userName}, your Tomato support ticket ${args.ticketId} has been received. Our review desk is investigating.`,
    });
  }

  /**
   * Real-Time Order Status Update Alert
   */
  public async notifyOrderUpdate(args: {
    phoneNumber: string;
    customerName: string;
    orderNumber: string;
    status: string;
    amount?: number;
    riderName?: string;
  }): Promise<ArattaiResponse> {
    const templateId = process.env.ARATTAI_ORDER_TEMPLATE_ID || 'order_status_alert';
    return this.sendNotification({
      phoneNumber: args.phoneNumber,
      templateId,
      params: {
        customer_name: args.customerName,
        order_number: args.orderNumber,
        status: args.status,
        total_amount: args.amount ? `₹${args.amount}` : '',
        rider_name: args.riderName || '',
      },
      message: `Hi ${args.customerName}, your Tomato order #${args.orderNumber} is now ${args.status}.${args.riderName ? ` Assigned rider: ${args.riderName}.` : ''}`,
    });
  }
}

export const arattaiNotificationService = new ArattaiNotificationService();
export default arattaiNotificationService;

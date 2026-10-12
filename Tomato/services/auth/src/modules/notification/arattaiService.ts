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
  private cachedAccessToken: string = process.env.ARATTAI_ACCESS_TOKEN || '';
  private tokenExpiresAt: number = 0;

  private get isEnabled(): boolean {
    return (
      process.env.ARATTAI_ENABLED === 'true' ||
      Boolean(
        (this.cachedAccessToken || process.env.ARATTAI_REFRESH_TOKEN) &&
        process.env.ARATTAI_COMPANY_ID
      )
    );
  }

  private get baseUrl(): string {
    return process.env.ARATTAI_BASE_URL || 'https://business.arattai.in';
  }

  private get companyId(): string {
    return process.env.ARATTAI_COMPANY_ID || '';
  }

  /**
   * Returns a valid access token. Automatically refreshes using refresh_token if expired.
   */
  public async getAccessToken(forceRefresh = false): Promise<string> {
    const now = Date.now();
    if (!forceRefresh && this.cachedAccessToken && (!this.tokenExpiresAt || this.tokenExpiresAt > now + 60000)) {
      return this.cachedAccessToken;
    }

    const refreshToken = process.env.ARATTAI_REFRESH_TOKEN;
    const clientId = process.env.ARATTAI_CLIENT_ID;
    const clientSecret = process.env.ARATTAI_CLIENT_SECRET;

    if (refreshToken && clientId && clientSecret) {
      try {
        console.log('[Arattai Notification] Refreshing access token via Arattai OAuth...');
        const resp = await axios.post(
          'https://accounts.arattai.in/oauth/v2/token',
          null,
          {
            params: {
              grant_type: 'refresh_token',
              refresh_token: refreshToken,
              client_id: clientId,
              client_secret: clientSecret,
            },
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10000,
          }
        );

        if (resp.data?.access_token) {
          this.cachedAccessToken = resp.data.access_token;
          const expiresIn = Number(resp.data.expires_in) || 3600;
          this.tokenExpiresAt = Date.now() + expiresIn * 1000;
          console.log('[Arattai Notification] Successfully refreshed OAuth access token.');
          return this.cachedAccessToken;
        }
      } catch (err: any) {
        console.error('[Arattai Notification] Token refresh failed:', err.response?.data || err.message);
      }
    }

    return this.cachedAccessToken || process.env.ARATTAI_ACCESS_TOKEN || '';
  }

  private get businessNumberId(): string {
    return process.env.ARATTAI_BUSINESS_NUMBER_ID || '';
  }

  /**
   * Formats Indian mobile number to +91-XXXXXXXXXX as strictly required by Arattai API regex:
   * ^\+?[1-9]\d{0,2}-\d{7,14}$
   */
  public formatIndianPhoneNumber(rawPhone: string): string | null {
    if (!rawPhone) return null;
    const digits = String(rawPhone).replace(/\D/g, '');
    if (digits.length === 10) {
      return `+91-${digits}`;
    } else if (digits.length === 12 && digits.startsWith('91')) {
      return `+91-${digits.slice(2)}`;
    } else if (digits.length === 11 && digits.startsWith('0')) {
      return `+91-${digits.slice(1)}`;
    }
    return digits.length >= 10 ? `+91-${digits.slice(-10)}` : null;
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

    let token = await this.getAccessToken();

    if (!this.isEnabled || !token || !this.companyId) {
      console.log(
        `[Arattai Notification (Mock/Dev)] Dispatch to Indian mobile ${formattedPhone}:`,
        {
          templateId: options.templateId,
          params: options.params,
          message: options.message,
          note: 'Provide ARATTAI_ACCESS_TOKEN and ARATTAI_COMPANY_ID in .env for live dispatch.',
        }
      );
      return { success: true, messageId: `mock-arrattai-${Date.now()}` };
    }

    try {
      // Official Arattai Transactional Payload:
      // { id: "<template_id>", phone_number: "+91-XXXXXXXXXX", variables: { ... } }
      const templateId =
        options.templateId || process.env.ARATTAI_DEFAULT_TEMPLATE_ID || 'general_notification';

      const payload: Record<string, unknown> = {
        id: templateId,
        phone_number: formattedPhone,
        variables: options.params || {},
      };

      if (options.message) {
        payload.variables = {
          message: options.message,
          ...(options.params || {}),
        };
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'Arattai-CompanyId': this.companyId,
        'Content-Type': 'application/json',
      };

      if (this.businessNumberId) {
        headers['Arattai-BusinessNumberId'] = this.businessNumberId;
      }

      let response;
      try {
        response = await axios.post(
          `${this.baseUrl}/api/v1/transactions`,
          payload,
          {
            headers,
            timeout: 10000,
          }
        );
      } catch (err: any) {
        // If 401 Unauthorized, try refreshing token once and re-requesting
        if (err.response?.status === 401 && process.env.ARATTAI_REFRESH_TOKEN) {
          console.warn('[Arattai Notification] Token expired (401). Attempting refresh and retry...');
          token = await this.getAccessToken(true);
          headers.Authorization = `Bearer ${token}`;
          response = await axios.post(
            `${this.baseUrl}/api/v1/transactions`,
            payload,
            {
              headers,
              timeout: 10000,
            }
          );
        } else {
          throw err;
        }
      }

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


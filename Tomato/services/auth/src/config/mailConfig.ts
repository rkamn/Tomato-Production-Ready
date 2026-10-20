export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromName: string;
  fromEmail: string;
  service?: string | undefined;
  enabled: boolean;
}

/**
 * Retrieve SMTP and Mail Transport configuration exclusively from environment variables (.env)
 */
export const getMailConfig = (): SmtpConfig => {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
  const pass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').replace(/\s+/g, '');
  const fromName = process.env.SMTP_FROM_NAME || 'Tomato Food & Grocery Delivery';
  const fromEmail = process.env.SMTP_FROM_EMAIL || user || 'no-reply@tomato.com';
  const service = process.env.SMTP_SERVICE || (host.includes('gmail') ? 'gmail' : undefined);
  const enabled = process.env.MAIL_ENABLED !== 'false' && Boolean(user && pass);

  return {
    host,
    port,
    secure: port === 465,
    user,
    pass,
    fromName,
    fromEmail,
    service,
    enabled,
  };
};

export default getMailConfig;

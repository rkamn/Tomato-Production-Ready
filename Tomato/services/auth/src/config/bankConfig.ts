export interface TomatoTreasuryBankDetails {
  companyName: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  upiId: string;
  branch: string;
  merchantCategoryCode: string;
  settlementPolicy: string;
}

/**
 * Retrieve official Tomato treasury bank details exclusively from environment variables (.env)
 */
export const getTomatoOfficialBankDetails = (): TomatoTreasuryBankDetails => ({
  companyName: process.env.TOMATO_COMPANY_NAME || '',
  accountHolderName: process.env.TOMATO_BANK_ACCOUNT_HOLDER || '',
  bankName: process.env.TOMATO_BANK_NAME || '',
  accountNumber: process.env.TOMATO_BANK_ACCOUNT_NUMBER || '',
  ifscCode: process.env.TOMATO_BANK_IFSC || '',
  upiId: process.env.TOMATO_OFFICIAL_UPI_ID || '',
  branch: process.env.TOMATO_BANK_BRANCH || '',
  merchantCategoryCode: process.env.TOMATO_MERCHANT_MCC || '',
  settlementPolicy: process.env.TOMATO_SETTLEMENT_POLICY || '',
});

export default getTomatoOfficialBankDetails;


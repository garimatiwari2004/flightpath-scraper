/** Mail provider types — mailtype=4 is cPanel Roundcube webmail on port 2096 */
export const MAIL_TYPES = {
  4: {
    name: 'cPanel Roundcube',
    defaultWebmailUrl: 'https://s784.bom1.mysecurecloudhost.com:2096/',
    loginPath: '/',
    otpSenders: ['flipkart', 'noreply@flipkart', 'fkrt.it'],
    otpPatterns: [
      /\b(\d{6})\b.*(?:otp|verification|login)/i,
      /(?:otp|verification|login).*?\b(\d{6})\b/i,
      /OTP[:\s]+(\d{6})/i,
      /(\d{6})\s+is\s+your\s+OTP/i,
    ],
  },
};

export const FLIPKART = {
  loginUrl: 'https://www.flipkart.com/account/login',
  otpWaitMs: 120_000,
  otpPollIntervalMs: 5_000,
  pageTimeoutMs: 60_000,
};

// RF DEWI Platform Configuration
// Edit these values to adjust platform-wide behaviour.

export const PLATFORM_FEE_PERCENT = 5;         // % taken from each transaction
export const BCRYPT_ROUNDS        = 12;         // bcrypt salt rounds (never go below 10)
export const SESSION_DAYS         = 7;          // session cookie lifetime
export const RESET_TOKEN_HOURS    = 1;          // password-reset token expiry
export const LOGIN_MAX_ATTEMPTS   = 5;          // rate-limit: max login tries
export const LOGIN_WINDOW_MINUTES = 15;         // rate-limit: rolling window
export const MIN_PASSWORD_LENGTH  = 8;          // enforced on change-password route
export const UPLOAD_MAX_MB        = 250;        // STL file upload limit

// Pricing defaults (applied when a shop hasn't configured their own)
export const DEFAULT_RATE_PER_CM3 = 0.18;      // NZD per cm³
export const DEFAULT_MIN_CHARGE   = 4.50;       // NZD minimum per job
export const DEFAULT_SETUP_FEE    = 3.50;       // NZD flat fee
export const DEFAULT_GST          = 0.15;       // 15% New Zealand GST

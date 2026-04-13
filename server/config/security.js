const getRequiredEnv = (key) => {
    const value = process.env[key];
    if (!value || !String(value).trim()) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return String(value).trim();
};

const getAllowedOrigins = () => {
    const raw = process.env.ALLOWED_ORIGINS || process.env.CLIENT_ORIGIN || '';
    return raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
};

const isOriginAllowed = (origin, allowedOrigins) => {
    if (!origin) return true; // non-browser tools/curl
    if (allowedOrigins.length === 0) return process.env.NODE_ENV !== 'production';
    return allowedOrigins.includes(origin);
};

module.exports = {
    getRequiredEnv,
    getAllowedOrigins,
    isOriginAllowed,
};

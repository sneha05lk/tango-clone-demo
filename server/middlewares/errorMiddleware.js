const logger = require('../config/logger');

const errorHandler = (err, req, res, next) => {
    logger.error(`[${req.method}] ${req.path} - ${err.message}`, {
        stack: err.stack,
        body: req.body,
        params: req.params,
        query: req.query,
        user: req.user ? req.user.id : 'guest'
    });

    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    
    res.status(statusCode).json({
        message: err.message || 'Internal Server Error',
        stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
};

const notFound = (req, res, next) => {
    const error = new Error(`Not Found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

module.exports = { errorHandler, notFound };

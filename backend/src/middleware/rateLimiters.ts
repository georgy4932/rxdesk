import rateLimit from 'express-rate-limit';

export const taskMutationRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many task update requests. Please try again shortly.'
  }
});

export const noteRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many note requests. Please try again shortly.'
  }
});

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const SUPABASE_JWKS_URL = `${process.env.SUPABASE_URL}/auth/v1/keys`;

const client = jwksClient({
  jwksUri: SUPABASE_JWKS_URL,
  cache: true,
  rateLimit: true
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid as string, function (err, key) {
    if (err) return callback(err, undefined);
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  jwt.verify(
    token,
    getKey,
    {
      audience: 'authenticated',
      issuer: `${process.env.SUPABASE_URL}/auth/v1`
    },
    (err, decoded: any) => {
      if (err || !decoded) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'staff',
        pharmacyId: decoded.pharmacy_id || null
      };

      next();
    }
  );
}

import { Request, Response, NextFunction } from 'express';

type Role = 'admin' | 'pharmacist' | 'staff';

export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Must be authenticated first
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    const userRole = req.user.role;

    // Defensive check (should never be undefined)
    if (!userRole) {
      return res.status(403).json({
        error: 'User role not set'
      });
    }

    // Enforce role access
    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        error: 'Forbidden: insufficient permissions'
      });
    }

    next();
  };
}

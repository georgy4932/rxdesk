import 'express';

export type AppUserRole = 'admin' | 'pharmacist' | 'staff';

declare global {
  namespace Express {
    interface User {
      id: string;
      pharmacyId: string;
      role: AppUserRole;
      email?: string;
    }

    interface Request {
      user?: User;
    }
  }
}

export {};

/**
 * Role-Based Access Control (RBAC) Middleware
 * Enforces access based on 5 user roles: participant, volunteer, sponsor, partner, admin
 *
 * IMPORTANT: This middleware trusts ONLY `req.user`, which is set exclusively
 * by the `auth()` middleware after independently verifying the caller's
 * Supabase access token. It never trusts client-supplied headers — an
 * `x-user-role` header, or any other client input, cannot be used to
 * escalate privileges. `auth()` MUST run before `requireRole()` on every
 * protected route, or requests will be correctly rejected as unauthenticated.
 */
export const requireRole = (allowedRoles = []) => {
  return (req, res, next) => {
    const userRole = req.user?.role;

    if (!userRole) {
      // auth() did not run, or did not succeed — never fall back to
      // trusting anything the client sent.
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (allowedRoles.length === 0 || allowedRoles.includes(userRole) || userRole === 'admin' || userRole === 'hq_admin') {
      return next();
    }

    return res.status(403).json({
      error: 'Forbidden',
      message: `Access denied. Requires one of [${allowedRoles.join(', ')}], current role is '${userRole}'`,
      code: 'RBAC_ACCESS_DENIED'
    });
  };
};

import { supabase } from '../config/supabase.js';

/**
 * Authentication middleware.
 *
 * Verifies the caller's Supabase access token against Supabase Auth itself
 * (rather than re-implementing JWT verification), then resolves the
 * caller's application role from the `profiles` table — never from a
 * client-supplied header. `req.user` is only ever set here, after the
 * token has been independently verified.
 *
 * Accepts the token either as an httpOnly cookie (`accessToken`, used by
 * the web dashboard) or as `Authorization: Bearer <token>` (used by
 * mobile / API clients).
 */
const auth = () => {
  return async (req, res, next) => {
    try {
      let token = req.cookies?.accessToken;

      if (!token) {
        const authHeader = req.headers['authorization'];
        if (authHeader?.startsWith('Bearer ')) {
          token = authHeader.slice(7);
        }
      }

      if (!token) {
        return res.status(401).json({ error: 'No token provided' });
      }

      // Verify the token directly with Supabase Auth. This confirms the
      // token is genuine and unexpired without the backend needing to
      // manage its own JWT signing secret.
      const { data: authData, error: authError } = await supabase.auth.getUser(token);

      if (authError || !authData?.user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const authUser = authData.user;

      // Resolve the application role from our own profiles table — this is
      // the single source of truth for authorization, never the client.
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role, full_name, email')
        .or(`auth_user_id.eq.${authUser.id},id.eq.${authUser.id}`)
        .maybeSingle();

      if (profileError) {
        console.error('[auth] Failed to resolve profile for authenticated user:', profileError.message);
        return res.status(500).json({ error: 'Failed to resolve user profile' });
      }

      if (!profile) {
        return res.status(403).json({ error: 'No profile found for authenticated account' });
      }

      req.user = {
        id: profile.id,
        authUserId: authUser.id,
        email: profile.email,
        // The frontend calls its HQ role `hq_admin`; backend route guards
        // consistently use `admin`.
        role: profile.role === 'hq_admin' ? 'admin' : profile.role,
        fullName: profile.full_name
      };

      next();
    } catch (err) {
      console.error('[auth] Unexpected error:', err.message || err);
      return res.status(401).json({ error: 'Authentication failed' });
    }
  };
};

export default auth;

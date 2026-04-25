const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY  // service_role — full DB access, stays server-side
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const ok  = (body) => ({ statusCode: 200, headers: HEADERS, body: JSON.stringify(body) });
const err = (code, msg) => ({ statusCode: code, headers: HEADERS, body: JSON.stringify({ error: msg }) });

// Extract + verify JWT → return Supabase user or null
async function getUser(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data: { user }, error } = await supabase.auth.getUser(auth.slice(7));
  return (error || !user) ? null : user;
}

// Get user + their org membership context
async function getCtx(event) {
  const user = await getUser(event);
  if (!user) return null;
  const { data: member } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single();
  return { userId: user.id, email: user.email, orgId: member?.org_id || null, role: member?.role || null };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const action = (event.queryStringParameters || {}).action;

  try {

    // ── GET profile ─────────────────────────────────────────
    if (action === 'profile' && event.httpMethod === 'GET') {
      const ctx = await getCtx(event);
      if (!ctx) return err(401, 'Unauthorized');
      if (!ctx.orgId) return ok({ needsOrg: true });

      const [{ data: org }, { data: sa }] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', ctx.orgId).single(),
        supabase.from('superadmins').select('user_id').eq('user_id', ctx.userId).single(),
      ]);
      return ok({ org, role: ctx.role, isSuperAdmin: !!sa });
    }

    // ── POST create-org (first-time setup after signup) ─────
    if (action === 'create-org' && event.httpMethod === 'POST') {
      const user = await getUser(event);
      if (!user) return err(401, 'Unauthorized');

      const { orgName, contactName } = JSON.parse(event.body || '{}');
      if (!orgName?.trim()) return err(400, 'Business name is required');

      // Prevent duplicate orgs for same user
      const { data: existing } = await supabase
        .from('org_members').select('org_id').eq('user_id', user.id).single();
      if (existing) return err(400, 'You already have an organization');

      const { data: org, error: orgErr } = await supabase
        .from('organizations')
        .insert({ name: orgName.trim(), owner_id: user.id, contact_email: user.email, contact_name: contactName?.trim() || '' })
        .select().single();
      if (orgErr) throw orgErr;

      const { error: memErr } = await supabase
        .from('org_members')
        .insert({ org_id: org.id, user_id: user.id, role: 'admin' });
      if (memErr) throw memErr;

      return ok({ ok: true, org });
    }

    // ── GET members (admin only) ─────────────────────────────
    if (action === 'members' && event.httpMethod === 'GET') {
      const ctx = await getCtx(event);
      if (!ctx || ctx.role !== 'admin') return err(403, 'Admins only');

      const { data: members } = await supabase
        .from('org_members').select('id, user_id, role, created_at').eq('org_id', ctx.orgId);

      const enriched = await Promise.all((members || []).map(async m => {
        const { data: { user } } = await supabase.auth.admin.getUserById(m.user_id);
        return { ...m, email: user?.email || '—' };
      }));
      return ok(enriched);
    }

    // ── POST invite (admin only) ─────────────────────────────
    if (action === 'invite' && event.httpMethod === 'POST') {
      const ctx = await getCtx(event);
      if (!ctx || ctx.role !== 'admin') return err(403, 'Admins only');

      const { email, role } = JSON.parse(event.body || '{}');
      if (!email?.trim() || !['admin', 'editor'].includes(role))
        return err(400, 'Valid email and role required');

      const siteUrl = process.env.SITE_URL || 'http://localhost:8888';

      // Invite (or re-invite) via Supabase Auth admin API
      const { data: invited, error: invErr } = await supabase.auth.admin.inviteUserByEmail(
        email.trim(),
        { redirectTo: `${siteUrl}/login.html` }
      );
      if (invErr) throw invErr;

      // Upsert membership (idempotent)
      const { data: existingMember } = await supabase
        .from('org_members').select('id').eq('user_id', invited.user.id).eq('org_id', ctx.orgId).single();
      if (!existingMember) {
        await supabase.from('org_members').insert({
          org_id: ctx.orgId, user_id: invited.user.id, role, invited_by: ctx.userId,
        });
      } else {
        await supabase.from('org_members').update({ role }).eq('id', existingMember.id);
      }
      return ok({ ok: true });
    }

    // ── DELETE remove-member (admin only) ───────────────────
    if (action === 'remove-member' && event.httpMethod === 'DELETE') {
      const ctx = await getCtx(event);
      if (!ctx || ctx.role !== 'admin') return err(403, 'Admins only');

      const { memberId } = JSON.parse(event.body || '{}');
      if (!memberId) return err(400, 'memberId required');
      // Prevent removing yourself
      const { data: m } = await supabase.from('org_members').select('user_id').eq('id', memberId).single();
      if (m?.user_id === ctx.userId) return err(400, 'Cannot remove yourself');
      await supabase.from('org_members').delete().eq('id', memberId).eq('org_id', ctx.orgId);
      return ok({ ok: true });
    }

    return err(404, 'Unknown action');
  } catch (e) {
    console.error('org-auth error:', e);
    return err(500, e.message);
  }
};

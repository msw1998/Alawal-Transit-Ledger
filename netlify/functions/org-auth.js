const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY  // service_role — full DB access, stays server-side
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
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
  const requestedOrgId = event.headers['x-org-id'];
  let query = supabase.from('org_members').select('org_id, role').eq('user_id', user.id);
  if (requestedOrgId) query = query.eq('org_id', requestedOrgId);
  const { data: members } = await query.order('created_at', { ascending: true }).limit(1);
  const member = members?.[0] || null;
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

      // Fetch all orgs this user belongs to (for org switcher)
      const { data: memberships } = await supabase
        .from('org_members').select('org_id, role').eq('user_id', ctx.userId);
      const orgIds = (memberships || []).map(m => m.org_id);

      const [{ data: org }, { data: allOrgRows }, { data: sa }] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', ctx.orgId).single(),
        supabase.from('organizations').select('id, name').in('id', orgIds),
        supabase.from('superadmins').select('user_id').eq('user_id', ctx.userId).single(),
      ]);

      const allOrgs = (allOrgRows || []).map(o => ({
        id: o.id, name: o.name,
        role: (memberships || []).find(m => m.org_id === o.id)?.role,
      }));

      return ok({ org, role: ctx.role, isSuperAdmin: !!sa, allOrgs });
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
      let targetUserId;
      let alreadyRegistered = false;

      // Try to send an invite email; if user already has an account, look them up instead
      const { data: invited, error: invErr } = await supabase.auth.admin.inviteUserByEmail(
        email.trim(),
        { redirectTo: `${siteUrl}/signup.html` }
      );

      if (invErr) {
        if (invErr.code !== 'email_exists') throw invErr;
        // User already registered — find their ID with exact email match
        alreadyRegistered = true;
        const normalised = email.trim().toLowerCase();
        let found = null;
        let page  = 1;
        while (!found) {
          const { data, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
          if (listErr) throw listErr;
          found = (data.users || []).find(u => u.email?.toLowerCase() === normalised) || null;
          if (found || (data.users || []).length < 1000) break;
          page++;
        }
        if (!found) throw new Error('User not found');
        targetUserId = found.id;
      } else {
        targetUserId = invited.user.id;
      }

      // Upsert membership (idempotent)
      const { data: existingMember } = await supabase
        .from('org_members').select('id').eq('user_id', targetUserId).eq('org_id', ctx.orgId).single();
      if (!existingMember) {
        const { error: memErr } = await supabase.from('org_members').insert({
          org_id: ctx.orgId, user_id: targetUserId, role, invited_by: ctx.userId,
        });
        if (memErr) throw memErr;
      } else {
        const { error: updErr } = await supabase.from('org_members').update({ role }).eq('id', existingMember.id);
        if (updErr) throw updErr;
      }
      return ok({ ok: true, userId: targetUserId, alreadyRegistered });
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

    // ── POST create-account (admin only) ─────────────────────
    if (action === 'create-account' && event.httpMethod === 'POST') {
      const ctx = await getCtx(event);
      if (!ctx || ctx.role !== 'admin') return err(403, 'Admins only');

      const { email, password, role } = JSON.parse(event.body || '{}');
      if (!email?.trim() || !password || password.length < 6 || !['admin', 'editor'].includes(role))
        return err(400, 'Valid email, password (6+ chars), and role required');

      let targetUserId;
      let alreadyExists = false;

      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email: email.trim(),
        password,
        email_confirm: true,
      });

      if (createErr) {
        const msg = (createErr.message || '').toLowerCase();
        if (createErr.code === 'email_exists' || msg.includes('already been registered') || msg.includes('already registered')) {
          alreadyExists = true;
          const normalised = email.trim().toLowerCase();
          let found = null, page = 1;
          while (!found) {
            const { data, error: listErr } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
            if (listErr) throw listErr;
            found = (data.users || []).find(u => u.email?.toLowerCase() === normalised) || null;
            if (found || (data.users || []).length < 1000) break;
            page++;
          }
          if (!found) return err(400, 'Email already exists but user not found in system');
          targetUserId = found.id;
        } else {
          throw createErr;
        }
      } else {
        targetUserId = created.user.id;
      }

      const { data: existingMember } = await supabase
        .from('org_members').select('id').eq('user_id', targetUserId).eq('org_id', ctx.orgId).single();
      if (!existingMember) {
        const { error: memErr } = await supabase.from('org_members').insert({
          org_id: ctx.orgId, user_id: targetUserId, role, invited_by: ctx.userId,
        });
        if (memErr) throw memErr;
      } else {
        const { error: updErr } = await supabase.from('org_members').update({ role }).eq('id', existingMember.id);
        if (updErr) throw updErr;
      }

      return ok({ ok: true, userId: targetUserId, alreadyExists });
    }

    // ── POST update-org (admin only) ──────────────────────────
    if (action === 'update-org' && event.httpMethod === 'POST') {
      const ctx = await getCtx(event);
      if (!ctx || ctx.role !== 'admin') return err(403, 'Admins only');

      const { name, address, phone, logoUrl } = JSON.parse(event.body || '{}');
      if (!name?.trim()) return err(400, 'Business name is required');

      const updates = { name: name.trim() };
      if (address !== undefined) updates.address = address;
      if (phone   !== undefined) updates.phone   = phone;
      if (logoUrl !== undefined) updates.logo_url = logoUrl;

      const { error: updErr } = await supabase
        .from('organizations').update(updates).eq('id', ctx.orgId);
      if (updErr) throw updErr;

      return ok({ ok: true });
    }

    return err(404, 'Unknown action');
  } catch (e) {
    console.error('org-auth error:', e);
    return err(500, e.message);
  }
};

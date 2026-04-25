require('dotenv').config();
const express = require('express');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

app.use(express.json());
app.use(express.static(path.join(__dirname)));   // serve index.html, login.html, etc.

// ── Auth helpers ─────────────────────────────────────────────
async function getUser(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data: { user }, error } = await supabase.auth.getUser(auth.slice(7));
  return (error || !user) ? null : user;
}

async function getCtx(req) {
  const user = await getUser(req);
  if (!user) return null;
  const { data: member } = await supabase
    .from('org_members').select('org_id, role').eq('user_id', user.id).single();
  if (!member) return null;
  return { userId: user.id, orgId: member.org_id, role: member.role, email: user.email };
}

// ── Config (public Supabase keys for frontend) ───────────────
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl:     process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});

// ── Entries ───────────────────────────────────────────────────
app.get('/api/entries', async (req, res) => {
  try {
    const ctx = await getCtx(req);
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase
      .from('entries').select('data').eq('org_id', ctx.orgId).order('date', { ascending: false });
    if (error) throw error;
    res.json(data.map(r => r.data));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/entries', async (req, res) => {
  try {
    const ctx = await getCtx(req);
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
    const entry = req.body;
    const { error } = await supabase.from('entries').upsert({
      id: entry.id, date: entry.date, driver: entry.driver,
      data: entry, org_id: ctx.orgId, updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/entries', async (req, res) => {
  try {
    const ctx = await getCtx(req);
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
    if (ctx.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    const { id } = req.body;
    const { error } = await supabase.from('entries').delete().eq('id', id).eq('org_id', ctx.orgId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Drivers ───────────────────────────────────────────────────
app.get('/api/drivers', async (req, res) => {
  try {
    const ctx = await getCtx(req);
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
    const { data, error } = await supabase
      .from('drivers').select('name').eq('org_id', ctx.orgId).order('name');
    if (error) throw error;
    res.json(data.map(d => d.name));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/drivers', async (req, res) => {
  try {
    const ctx = await getCtx(req);
    if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { error } = await supabase.from('drivers').upsert(
      { name: name.trim(), org_id: ctx.orgId },
      { onConflict: 'name,org_id', ignoreDuplicates: true }
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Org Auth ──────────────────────────────────────────────────
app.get('/api/org-auth', async (req, res) => {
  const action = req.query.action;
  try {
    if (action === 'profile') {
      const ctx = await getCtx(req);
      if (!ctx) return res.status(401).json({ error: 'Unauthorized' });
      if (!ctx.orgId) return res.json({ needsOrg: true });
      const [{ data: org }, { data: sa }] = await Promise.all([
        supabase.from('organizations').select('*').eq('id', ctx.orgId).single(),
        supabase.from('superadmins').select('user_id').eq('user_id', ctx.userId).single(),
      ]);
      return res.json({ org, role: ctx.role, isSuperAdmin: !!sa });
    }

    if (action === 'members') {
      const ctx = await getCtx(req);
      if (!ctx || ctx.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      const { data: members } = await supabase
        .from('org_members').select('id, user_id, role, created_at').eq('org_id', ctx.orgId);
      const enriched = await Promise.all((members || []).map(async m => {
        const { data: { user } } = await supabase.auth.admin.getUserById(m.user_id);
        return { ...m, email: user?.email || '—' };
      }));
      return res.json(enriched);
    }

    res.status(404).json({ error: 'Unknown action' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/org-auth', async (req, res) => {
  const action = req.query.action;
  try {
    if (action === 'create-org') {
      const user = await getUser(req);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const { orgName, contactName } = req.body;
      if (!orgName?.trim()) return res.status(400).json({ error: 'Business name required' });
      const { data: existing } = await supabase
        .from('org_members').select('org_id').eq('user_id', user.id).single();
      if (existing) return res.status(400).json({ error: 'User already has an organization' });
      const { data: org, error: orgErr } = await supabase
        .from('organizations')
        .insert({ name: orgName.trim(), owner_id: user.id, contact_email: user.email, contact_name: contactName?.trim() || '' })
        .select().single();
      if (orgErr) throw orgErr;
      const { error: memErr } = await supabase
        .from('org_members').insert({ org_id: org.id, user_id: user.id, role: 'admin' });
      if (memErr) throw memErr;
      return res.json({ ok: true, org });
    }

    if (action === 'invite') {
      const ctx = await getCtx(req);
      if (!ctx || ctx.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      const { email, role } = req.body;
      if (!email?.trim() || !['admin', 'editor'].includes(role))
        return res.status(400).json({ error: 'Valid email and role required' });
      const siteUrl = process.env.SITE_URL || `http://localhost:${PORT}`;
      const { data: invited, error: invErr } = await supabase.auth.admin.inviteUserByEmail(
        email.trim(), { redirectTo: `${siteUrl}/login.html` }
      );
      if (invErr) throw invErr;
      const { data: existingMember } = await supabase
        .from('org_members').select('id').eq('user_id', invited.user.id).eq('org_id', ctx.orgId).single();
      if (!existingMember) {
        await supabase.from('org_members').insert({
          org_id: ctx.orgId, user_id: invited.user.id, role, invited_by: ctx.userId,
        });
      } else {
        await supabase.from('org_members').update({ role }).eq('id', existingMember.id);
      }
      return res.json({ ok: true });
    }

    res.status(404).json({ error: 'Unknown action' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/org-auth', async (req, res) => {
  const action = req.query.action;
  try {
    if (action === 'remove-member') {
      const ctx = await getCtx(req);
      if (!ctx || ctx.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
      const { memberId } = req.body;
      if (!memberId) return res.status(400).json({ error: 'memberId required' });
      const { data: m } = await supabase.from('org_members').select('user_id').eq('id', memberId).single();
      if (m?.user_id === ctx.userId) return res.status(400).json({ error: 'Cannot remove yourself' });
      await supabase.from('org_members').delete().eq('id', memberId).eq('org_id', ctx.orgId);
      return res.json({ ok: true });
    }
    res.status(404).json({ error: 'Unknown action' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Superadmin ────────────────────────────────────────────────
app.get('/api/superadmin-api', async (req, res) => {
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const { data: sa } = await supabase.from('superadmins').select('user_id').eq('user_id', user.id).single();
    if (!sa) return res.status(403).json({ error: 'Forbidden' });

    const { data: orgs } = await supabase
      .from('organizations').select('*').order('created_at', { ascending: false });
    const enriched = await Promise.all((orgs || []).map(async org => {
      const [{ count: memberCount }, { count: entryCount }] = await Promise.all([
        supabase.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
        supabase.from('entries').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
      ]);
      return { ...org, memberCount: memberCount || 0, entryCount: entryCount || 0 };
    }));
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Fallback: serve index.html for any unmatched route ───────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

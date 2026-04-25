const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

async function getAuthContext(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  const { data: { user }, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !user) return null;
  const { data: member } = await supabase
    .from('org_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .single();
  if (!member) return null;
  return { userId: user.id, orgId: member.org_id, role: member.role };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  const ctx = await getAuthContext(event);
  if (!ctx) return { statusCode: 401, headers: HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('entries')
        .select('data')
        .eq('org_id', ctx.orgId)
        .order('date', { ascending: false });
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data.map(r => r.data)) };
    }

    if (event.httpMethod === 'POST') {
      const entry = JSON.parse(event.body);
      const { error } = await supabase.from('entries').upsert({
        id:         entry.id,
        date:       entry.date,
        driver:     entry.driver,
        data:       entry,
        org_id:     ctx.orgId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    if (event.httpMethod === 'DELETE') {
      // Editors cannot delete
      if (ctx.role !== 'admin') {
        return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Admins only' }) };
      }
      const { id } = JSON.parse(event.body);
      const { error } = await supabase.from('entries').delete().eq('id', id).eq('org_id', ctx.orgId);
      if (error) throw error;
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 405, headers: HEADERS, body: 'Method Not Allowed' };
  } catch (err) {
    console.error('entries fn error:', err);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};

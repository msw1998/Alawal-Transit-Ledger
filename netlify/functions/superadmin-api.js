const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

async function isSuperAdmin(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  if (!auth.startsWith('Bearer ')) return false;
  const { data: { user }, error } = await supabase.auth.getUser(auth.slice(7));
  if (error || !user) return false;
  const { data } = await supabase.from('superadmins').select('user_id').eq('user_id', user.id).single();
  return !!data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  if (!await isSuperAdmin(event)) {
    return { statusCode: 403, headers: HEADERS, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  try {
    const { data: orgs } = await supabase
      .from('organizations')
      .select('*')
      .order('created_at', { ascending: false });

    const enriched = await Promise.all((orgs || []).map(async org => {
      const [
        { count: memberCount },
        { count: entryCount },
      ] = await Promise.all([
        supabase.from('org_members').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
        supabase.from('entries').select('id', { count: 'exact', head: true }).eq('org_id', org.id),
      ]);
      return { ...org, memberCount: memberCount || 0, entryCount: entryCount || 0 };
    }));

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(enriched) };
  } catch (e) {
    console.error('superadmin-api error:', e);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
  }
};

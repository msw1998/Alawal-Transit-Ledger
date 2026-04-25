// Returns public Supabase config to the frontend.
// The anon key is safe to expose (designed for browser use).
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({
      supabaseUrl:     process.env.SUPABASE_URL,
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
    }),
  };
};

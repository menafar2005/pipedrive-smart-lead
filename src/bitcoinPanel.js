import { externalApiFetch } from './externalApi.js';

async function getBitcoinPrice(env) {
  const response = await externalApiFetch(
    env,
    'coingecko',
    0,
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true',
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'pipedrive-smart-assignment-app'
      }
    }
  );

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error('Invalid JSON from CoinGecko: ' + text.substring(0, 200));
  }
  if (!response.ok) throw new Error('CoinGecko HTTP ' + response.status + ': ' + text.substring(0, 200));
  if (!data.bitcoin) throw new Error('Bitcoin data missing: ' + JSON.stringify(data).substring(0, 200));

  return {
    usd: data.bitcoin.usd,
    change24h: data.bitcoin.usd_24h_change,
    lastUpdatedAt: data.bitcoin.last_updated_at
  };
}

export async function getBitcoinJsonPanel(env) {
  try {
    const price = await getBitcoinPrice(env);
    return Response.json({
      data: {
        id: 1,
        header: 'Bitcoin price',
        price: `$${Number(price.usd).toLocaleString()}`,
        change_24h: `${Number(price.change24h).toFixed(2)}%`,
        last_updated: new Date(price.lastUpdatedAt * 1000).toISOString()
      }
    });
  } catch (error) {
    return Response.json({
      data: {
        id: 1,
        header: 'Bitcoin price',
        price: 'Unavailable',
        change_24h: '-',
        last_updated: new Date().toISOString()
      }
    });
  }
}

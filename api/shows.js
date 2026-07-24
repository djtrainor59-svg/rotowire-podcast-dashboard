const shows = require('./_lib/shows');

module.exports = (req, res) => {
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).json({ shows: shows.map(({ id, name, short }) => ({ id, name, short })) });
};

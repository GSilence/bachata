import { buildTracksWhere } from '../lib/trackQuery';

const tests = [
  { name: 'accents=1', params: new URLSearchParams({ accents: '1', filter: 'free' }) },
  { name: 'mambo=1', params: new URLSearchParams({ mambo: '1', filter: 'free' }) },
  { name: 'bridges=with', params: new URLSearchParams({ bridges: 'with', filter: 'free' }) },
  { name: 'no filters', params: new URLSearchParams({ filter: 'free' }) },
];

for (const test of tests) {
  const where = buildTracksWhere(test.params, true);
  console.log(test.name + ' [admin]:', JSON.stringify(where));
}

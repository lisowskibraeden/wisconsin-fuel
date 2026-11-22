const brandLogos = [
  [/^kwik\s+trip\b/i, 'kwik-trip.svg'],
  [/^stop[ -]+n[ -]+go\b/i, 'stop-n-go.png'],
  [/^bp\b/i, 'bp.png'],
  [/^cenex\b/i, 'cenex.png'],
  [/^mobil\b/i, 'mobil.png'],
  [/^shell\b/i, 'shell.png'],
  [/^citgo\b/i, 'citgo.png'],
  [/^amoco\b/i, 'amoco.png'],
  [/^holiday\b/i, 'holiday.svg'],
  [/^casey['’]?s\b/i, 'caseys.png'],
  [/^krist\b/i, 'krist.png'],
  [/^clark\b/i, 'clark.png'],
  [/^marathon\b/i, 'marathon.png'],
  [/^phillips\s+66\b/i, 'phillips-66.png'],
  [/^woodman['’]?s\b/i, 'woodmans.png'],
  [/^fleet\s+farm\b/i, 'fleet-farm.png'],
  [/^costco\b/i, 'costco.svg'],
  [/^circle\s+k\b/i, 'circle-k.svg'],
  [/^exxon\b/i, 'exxon.png'],
  [/^sunoco\b/i, 'sunoco.svg'],
  [/^meijer\b/i, 'meijer.svg'],
  [/^sam['’]?s\s+club\b/i, 'sams-club.png'],
  [/^hy[ -]+vee\b/i, 'hy-vee.png'],
  [/^arco\b/i, 'arco.png'],
  [/^vp\s+racing\b/i, 'vp-racing.png'],
  [/^minit\s+mart\b/i, 'minit-mart.png'],
  [/(?:^|\s)iga$/i, 'iga.png'],
];

export function stationLogoFile(name) {
  return brandLogos.find(([pattern]) => pattern.test(name.trim()))?.[1];
}
